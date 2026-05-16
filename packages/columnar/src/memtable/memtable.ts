/**
 * MemTable — columnar in-memory write buffer.
 *
 * Per spec §2.5: incoming rows are decomposed into per-column
 * TypedArrays at admission, never round-tripping through JS objects
 * after the call into `addRow`. Flush triggers (any one):
 *
 *   - row count       ≥ maxRows         (default 250 000)
 *   - approx bytes    ≥ maxByteSize     (default 64 MiB)
 *   - wall-clock age  ≥ maxAgeMs        (default 60 s)
 *
 * `buildSegment()` materialises the accumulated state into a
 * `SegmentSpec` ready for `encodeSegment`. Encoding picked per
 * column type:
 *
 *   Int32   → delta-FOR (RawInt32 fallback on overflow)
 *   Uint32  → RawUint32
 *   Int64   → RawInt64
 *   Float64 → RawFloat64
 *   String  → Dictionary
 *
 * Encoding choice is intentionally simple in this revision; the
 * adaptive encoder ("try multiple, pick smallest") is a follow-up
 * once Gorilla / ZSTD land.
 *
 * `addBatch(columns, rowCount)` is the column-oriented admission
 * path used by compaction: it accepts a Map of columnId → typed
 * slice and bulk-appends each into the corresponding buffer
 * without row-by-row overhead.
 */

import {
  DeltaForOverflowError,
  encodeDeltaForInt32,
  encodeRawFloat64,
  encodeRawInt32,
  encodeRawInt64,
  encodeRawUint32,
  encodeStringDictionary,
} from '../encodings/index';
import { type ColumnSpec, ColumnTypeId, type PageSpec, type SegmentSpec } from '../segment/types';
import {
  zonemapForFloat64,
  zonemapForInt32,
  zonemapForInt64,
  zonemapForUint32,
} from '../segment/zonemap';
import type { EncodedColumn } from '../types';
import {
  type AnyBuffer,
  BigInt64Buffer,
  Float64Buffer,
  Int32Buffer,
  StringBuffer,
  Uint32Buffer,
} from './buffer';
import type { ColumnSchema, ColumnValue, MemTableConfig } from './types';

const DEFAULT_MAX_ROWS = 250_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 60_000;
const DEFAULT_PAGE_ROWS = 8192;

interface ColumnState {
  readonly schema: ColumnSchema;
  readonly buffer: AnyBuffer;
}

/** TypedArray-or-string-array shape accepted by addBatch. */
export type ColumnSlice =
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | Float64Array
  | readonly string[];

export class MemTable {
  readonly config: MemTableConfig;
  private readonly maxRows: number;
  private readonly maxByteSize: number;
  private readonly maxAgeMs: number;
  private readonly pageRows: number;
  private readonly columns: ColumnState[];
  private readonly columnsById: Map<number, ColumnState>;
  private rowCount_ = 0;
  private createdAt: number;

  constructor(config: MemTableConfig) {
    if (config.schema.length === 0) {
      throw new RangeError('MemTable: schema must declare at least one column');
    }
    this.config = config;
    this.maxRows = config.maxRows ?? DEFAULT_MAX_ROWS;
    this.maxByteSize = config.maxByteSize ?? DEFAULT_MAX_BYTES;
    this.maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.pageRows = config.pageRows ?? DEFAULT_PAGE_ROWS;
    this.columns = config.schema.map((s) => ({
      schema: s,
      buffer: createBuffer(s.type),
    }));
    this.columnsById = new Map(this.columns.map((c) => [c.schema.id, c] as const));
    this.createdAt = Date.now();
  }

  /**
   * Append a row. `values` must be in the same order as the schema
   * passed at construction. Each value's runtime type must match
   * its column's declared type.
   */
  addRow(values: readonly ColumnValue[]): void {
    if (values.length !== this.columns.length) {
      throw new RangeError(
        `MemTable.addRow: expected ${this.columns.length} values, got ${values.length}`,
      );
    }
    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i] as ColumnState;
      pushTyped(col, values[i] as ColumnValue);
    }
    this.rowCount_++;
  }

  /**
   * Column-oriented bulk admission. `columns` maps column id to a
   * typed slice; every entry must be `rowCount` elements long, and
   * every column in the schema must be represented. The single
   * pre-grow + memcpy path avoids per-row allocation.
   */
  addBatch(columns: ReadonlyMap<number, ColumnSlice>, rowCount: number): void {
    if (rowCount < 0 || !Number.isInteger(rowCount)) {
      throw new RangeError(`MemTable.addBatch: rowCount must be a non-negative integer`);
    }
    if (rowCount === 0) return;
    for (const col of this.columns) {
      const slice = columns.get(col.schema.id);
      if (!slice) {
        throw new RangeError(
          `MemTable.addBatch: missing column id ${col.schema.id} ("${col.schema.name}")`,
        );
      }
      if (slice.length < rowCount) {
        throw new RangeError(
          `MemTable.addBatch: column ${col.schema.id} slice has ${slice.length} values, need ${rowCount}`,
        );
      }
      pushBulkTyped(col, slice, rowCount);
    }
    this.rowCount_ += rowCount;
  }

  get rowCount(): number {
    return this.rowCount_;
  }

  get byteSize(): number {
    let total = 0;
    for (const c of this.columns) total += c.buffer.byteSize;
    return total;
  }

  get ageMs(): number {
    return Date.now() - this.createdAt;
  }

  /** True if any flush trigger is satisfied. */
  shouldFlush(): boolean {
    return (
      this.rowCount_ >= this.maxRows ||
      this.byteSize >= this.maxByteSize ||
      this.ageMs >= this.maxAgeMs
    );
  }

  /** True if no rows have been admitted. */
  isEmpty(): boolean {
    return this.rowCount_ === 0;
  }

  /**
   * Materialise the accumulated state into a SegmentSpec.
   * The MemTable is NOT cleared by this call; the caller decides
   * when to `reset()` after the segment is durable.
   */
  buildSegment(): SegmentSpec {
    const cols: ColumnSpec[] = [];
    for (const c of this.columns) {
      cols.push(this.buildColumn(c));
    }
    return Object.freeze({ columns: Object.freeze(cols) });
  }

  /** Clear all buffers and reset the age clock. */
  reset(): void {
    for (const c of this.columns) c.buffer.reset();
    this.rowCount_ = 0;
    this.createdAt = Date.now();
  }

  private buildColumn(c: ColumnState): ColumnSpec {
    const total = c.buffer.size;
    const pageSize = this.pageRows;
    const pages: PageSpec[] = [];
    for (let start = 0; start < total; start += pageSize) {
      const end = Math.min(start + pageSize, total);
      pages.push(this.buildPage(c, start, end));
    }
    return Object.freeze({
      id: c.schema.id,
      name: c.schema.name,
      type: c.schema.type,
      pages: Object.freeze(pages),
    });
  }

  private buildPage(c: ColumnState, start: number, end: number): PageSpec {
    const rowCount = end - start;
    switch (c.schema.type) {
      case ColumnTypeId.Int32: {
        const buf = c.buffer as Int32Buffer;
        const slice = buf.view().subarray(start, end);
        let encoded: EncodedColumn;
        try {
          encoded = encodeDeltaForInt32(slice);
        } catch (e) {
          if (e instanceof DeltaForOverflowError) {
            encoded = encodeRawInt32(slice);
          } else {
            throw e;
          }
        }
        return {
          encoded,
          rowCount,
          zonemap: zonemapForInt32(slice),
        };
      }
      case ColumnTypeId.Uint32: {
        const buf = c.buffer as Uint32Buffer;
        const slice = buf.view().subarray(start, end);
        return {
          encoded: encodeRawUint32(slice),
          rowCount,
          zonemap: zonemapForUint32(slice),
        };
      }
      case ColumnTypeId.Int64: {
        const buf = c.buffer as BigInt64Buffer;
        const slice = buf.view().subarray(start, end);
        return {
          encoded: encodeRawInt64(slice),
          rowCount,
          zonemap: zonemapForInt64(slice),
        };
      }
      case ColumnTypeId.Float64: {
        const buf = c.buffer as Float64Buffer;
        const slice = buf.view().subarray(start, end);
        return {
          encoded: encodeRawFloat64(slice),
          rowCount,
          zonemap: zonemapForFloat64(slice),
        };
      }
      case ColumnTypeId.String: {
        const buf = c.buffer as StringBuffer;
        const slice = buf.slice(start, end);
        return {
          encoded: encodeStringDictionary(slice),
          rowCount,
        };
      }
      default:
        throw new Error(
          `MemTable.buildPage: unsupported column type ${c.schema.type as number} for column "${c.schema.name}"`,
        );
    }
  }
}

function createBuffer(type: number): AnyBuffer {
  switch (type) {
    case ColumnTypeId.Int32:
      return new Int32Buffer();
    case ColumnTypeId.Uint32:
      return new Uint32Buffer();
    case ColumnTypeId.Int64:
      return new BigInt64Buffer();
    case ColumnTypeId.Float64:
      return new Float64Buffer();
    case ColumnTypeId.String:
      return new StringBuffer();
    default:
      throw new RangeError(`MemTable: unsupported column type ${type}`);
  }
}

function pushTyped(col: ColumnState, value: ColumnValue): void {
  switch (col.schema.type) {
    case ColumnTypeId.Int32:
      (col.buffer as Int32Buffer).push(value as number);
      return;
    case ColumnTypeId.Uint32:
      (col.buffer as Uint32Buffer).push(value as number);
      return;
    case ColumnTypeId.Int64:
      (col.buffer as BigInt64Buffer).push(value as bigint);
      return;
    case ColumnTypeId.Float64:
      (col.buffer as Float64Buffer).push(value as number);
      return;
    case ColumnTypeId.String:
      (col.buffer as StringBuffer).push(value as string);
      return;
    default:
      throw new Error(`MemTable: unsupported column type ${col.schema.type as number}`);
  }
}

function pushBulkTyped(col: ColumnState, slice: ColumnSlice, count: number): void {
  // For numeric slices, we always have a TypedArray; for strings,
  // a readonly string[]. Cap to `count` entries.
  switch (col.schema.type) {
    case ColumnTypeId.Int32: {
      const arr = slice as Int32Array;
      const view = arr.length === count ? arr : arr.subarray(0, count);
      (col.buffer as Int32Buffer).pushBulk(view);
      return;
    }
    case ColumnTypeId.Uint32: {
      const arr = slice as Uint32Array;
      const view = arr.length === count ? arr : arr.subarray(0, count);
      (col.buffer as Uint32Buffer).pushBulk(view);
      return;
    }
    case ColumnTypeId.Int64: {
      const arr = slice as BigInt64Array;
      const view = arr.length === count ? arr : arr.subarray(0, count);
      (col.buffer as BigInt64Buffer).pushBulk(view);
      return;
    }
    case ColumnTypeId.Float64: {
      const arr = slice as Float64Array;
      const view = arr.length === count ? arr : arr.subarray(0, count);
      (col.buffer as Float64Buffer).pushBulk(view);
      return;
    }
    case ColumnTypeId.String: {
      const arr = slice as readonly string[];
      const view = arr.length === count ? arr : arr.slice(0, count);
      (col.buffer as StringBuffer).pushBulk(view);
      return;
    }
    default:
      throw new Error(`MemTable.addBatch: unsupported column type ${col.schema.type as number}`);
  }
}
