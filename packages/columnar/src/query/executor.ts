/**
 * Vectorised pipeline operators and high-level `query()` helper.
 *
 * Each operator is a generator that consumes one upstream batch
 * at a time and yields zero or more downstream batches. Batches
 * stay column-oriented end to end — no row materialisation unless
 * the caller asks via `collect()`.
 *
 * Predicate pushdown: the scan accepts a `skipFilter` predicate
 * and consults each scanned column's zonemap (via `canSkipPage`)
 * to skip pages without decoding. The filter operator still runs
 * the predicate against the surviving rows for exact matching.
 *
 * Column-set rule for `query()`:
 *   scan-columns = projected ∪ filter-referenced
 *   filter operates on the full batch (so predicates on
 *      filter-only columns evaluate correctly)
 *   project reduces back to the user-requested columns
 *      (drops filter-only columns from the output)
 *   limit caps the total row count
 */

import type { SegmentReader } from '../segment/reader';
import type { ColumnMetadata } from '../segment/types';
import { decodePage } from './decode';
import { canSkipPage, evaluatePredicate } from './predicate';
import type { ColumnArray, ColumnarBatch, Predicate } from './types';

export interface QueryOptions {
  /** Column ids to project. Must be present in the segment. */
  readonly columns: readonly number[];
  /** Predicate applied to every row. Drives page-skip and per-row filter. */
  readonly filter?: Predicate;
  /** Stop after N rows total. */
  readonly limit?: number;
}

/** High-level query entry point. Returns a generator of batches. */
export function query(reader: SegmentReader, opts: QueryOptions): Generator<ColumnarBatch> {
  // Compute the union of projected columns and any columns referenced
  // by the filter predicate. The filter must see its referenced
  // columns in the batch, even if the caller didn't ask to project them.
  const requested = new Set(opts.columns);
  const filterCols = opts.filter ? Array.from(collectFilterColumns(opts.filter)) : [];
  const extras = filterCols.filter((c) => !requested.has(c));
  const scanCols = extras.length > 0 ? [...opts.columns, ...extras] : opts.columns;

  let stream: Generator<ColumnarBatch> = scan(
    reader,
    scanCols,
    opts.filter ? { skipFilter: opts.filter } : {},
  );
  if (opts.filter) stream = filter(stream, opts.filter);
  if (extras.length > 0) {
    // Project back to the user-requested columns, dropping
    // filter-only columns that were only scanned for predicate eval.
    stream = project(stream, opts.columns);
  }
  if (opts.limit !== undefined) stream = limit(stream, opts.limit);
  return stream;
}

// ---- scan ----

interface ScanOptions {
  readonly skipFilter?: Predicate;
}

export function* scan(
  reader: SegmentReader,
  columnIds: readonly number[],
  opts: ScanOptions = {},
): Generator<ColumnarBatch> {
  if (columnIds.length === 0) {
    throw new RangeError('scan: at least one column id required');
  }
  const colMetas: ColumnMetadata[] = [];
  const colMetasById = new Map<number, ColumnMetadata>();
  for (const id of columnIds) {
    const md = reader.column(id);
    if (!md) throw new RangeError(`scan: column ${id} not present in segment`);
    colMetas.push(md);
    colMetasById.set(id, md);
  }

  const pageCount = (colMetas[0] as ColumnMetadata).pages.length;
  for (const md of colMetas) {
    if (md.pages.length !== pageCount) {
      throw new RangeError(
        `scan: column ${md.id} has ${md.pages.length} pages, expected ${pageCount}`,
      );
    }
  }

  for (let pi = 0; pi < pageCount; pi++) {
    if (opts.skipFilter && canSkipPage(opts.skipFilter, colMetasById, pi)) {
      continue;
    }
    const cols = new Map<number, ColumnArray>();
    const rowCount = (colMetas[0] as ColumnMetadata).pages[pi]?.rowCount ?? 0;
    for (const md of colMetas) {
      const encoded = reader.readPage(md.id, pi);
      const values = decodePage(encoded, md.type);
      cols.set(md.id, values);
    }
    yield Object.freeze({ length: rowCount, columns: cols });
  }
}

// ---- filter ----

export function* filter(
  child: Iterable<ColumnarBatch>,
  predicate: Predicate,
): Generator<ColumnarBatch> {
  for (const batch of child) {
    const mask = evaluatePredicate(predicate, batch);
    let survivors = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) survivors++;
    if (survivors === 0) continue;
    if (survivors === batch.length) {
      yield batch;
      continue;
    }
    yield applyMask(batch, mask, survivors);
  }
}

// ---- project ----

export function* project(
  child: Iterable<ColumnarBatch>,
  columnIds: readonly number[],
): Generator<ColumnarBatch> {
  for (const batch of child) {
    const cols = new Map<number, ColumnArray>();
    for (const id of columnIds) {
      const v = batch.columns.get(id);
      if (!v) continue;
      cols.set(id, v);
    }
    yield Object.freeze({ length: batch.length, columns: cols });
  }
}

// ---- limit ----

export function* limit(child: Iterable<ColumnarBatch>, n: number): Generator<ColumnarBatch> {
  if (n <= 0) return;
  let remaining = n;
  for (const batch of child) {
    if (remaining <= 0) return;
    if (batch.length <= remaining) {
      remaining -= batch.length;
      yield batch;
    } else {
      yield truncateBatch(batch, remaining);
      return;
    }
  }
}

// ---- collect helper ----

/**
 * Convenience for tests and small queries: materialise all yielded
 * batches into a single per-column row array.
 */
export function collect(stream: Iterable<ColumnarBatch>): {
  readonly length: number;
  readonly columns: ReadonlyMap<number, unknown[]>;
} {
  const cols = new Map<number, unknown[]>();
  let total = 0;
  for (const batch of stream) {
    total += batch.length;
    for (const [colId, values] of batch.columns) {
      let acc = cols.get(colId);
      if (!acc) {
        acc = [];
        cols.set(colId, acc);
      }
      for (let i = 0; i < batch.length; i++) {
        acc.push((values as { [k: number]: unknown })[i]);
      }
    }
  }
  return { length: total, columns: cols };
}

// ---- internal helpers ----

function applyMask(batch: ColumnarBatch, mask: Uint8Array, survivors: number): ColumnarBatch {
  const out = new Map<number, ColumnArray>();
  for (const [colId, values] of batch.columns) {
    out.set(colId, compactColumn(values, mask, survivors));
  }
  return Object.freeze({ length: survivors, columns: out });
}

function compactColumn(values: ColumnArray, mask: Uint8Array, survivors: number): ColumnArray {
  if (values instanceof Int32Array) {
    const out = new Int32Array(survivors);
    let j = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) out[j++] = values[i] as number;
    return out;
  }
  if (values instanceof Uint32Array) {
    const out = new Uint32Array(survivors);
    let j = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) out[j++] = values[i] as number;
    return out;
  }
  if (values instanceof Float64Array) {
    const out = new Float64Array(survivors);
    let j = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) out[j++] = values[i] as number;
    return out;
  }
  if (values instanceof BigInt64Array) {
    const out = new BigInt64Array(survivors);
    let j = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) out[j++] = values[i] as bigint;
    return out;
  }
  const arr = values as readonly string[];
  const out: string[] = new Array(survivors);
  let j = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) out[j++] = arr[i] as string;
  return out;
}

function truncateBatch(batch: ColumnarBatch, n: number): ColumnarBatch {
  const out = new Map<number, ColumnArray>();
  for (const [colId, values] of batch.columns) {
    out.set(colId, truncateColumn(values, n));
  }
  return Object.freeze({ length: n, columns: out });
}

function truncateColumn(values: ColumnArray, n: number): ColumnArray {
  if (values instanceof Int32Array) return values.subarray(0, n);
  if (values instanceof Uint32Array) return values.subarray(0, n);
  if (values instanceof Float64Array) return values.subarray(0, n);
  if (values instanceof BigInt64Array) return values.subarray(0, n);
  return (values as readonly string[]).slice(0, n);
}

function collectFilterColumns(p: Predicate, out: Set<number> = new Set()): Set<number> {
  switch (p.kind) {
    case 'num':
    case 'bigint':
    case 'str':
      out.add(p.column);
      return out;
    case 'and':
    case 'or':
      for (const sub of p.predicates) collectFilterColumns(sub, out);
      return out;
  }
}
