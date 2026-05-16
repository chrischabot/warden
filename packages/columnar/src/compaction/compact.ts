/**
 * Segment compaction.
 *
 * `compactSegments(sources, pageRows?)` merges N source segments
 * into one. The merge:
 *
 *   1. Validates that all sources share the same schema (column
 *      id / name / type lists, identical order). Schema evolution
 *      across segments is a follow-up.
 *   2. For each column, scans every source segment page-by-page,
 *      decodes the page, and pushes the typed slice into a fresh
 *      MemTable via `addBatch` (one pre-grow + memcpy per page).
 *   3. Re-emits the accumulated state via `MemTable.buildSegment`
 *      and `encodeSegment` — fresh pages of `pageRows` rows each
 *      with new zonemaps and the encoding chosen by the MemTable
 *      heuristics.
 *
 * Single-segment input is a no-op: the original byte buffer is
 * returned as-is. Empty input throws.
 */

import { MemTable } from '../memtable/memtable';
import { decodePage } from '../query/decode';
import type { ColumnArray } from '../query/types';
import type { SegmentReader } from '../segment/reader';
import type { ColumnMetadata, ColumnTypeIdValue } from '../segment/types';
import { encodeSegment } from '../segment/writer';

export interface CompactOptions {
  /** Rows per output page. Default 8192. */
  readonly pageRows?: number;
}

export class SchemaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMismatchError';
  }
}

export function compactSegments(
  sources: readonly SegmentReader[],
  options: CompactOptions = {},
): Uint8Array {
  if (sources.length === 0) {
    throw new RangeError('compactSegments: at least one source segment required');
  }
  if (sources.length === 1) {
    // Trivial no-op for callers that hand us a single segment.
    return (sources[0] as SegmentReader).bytes;
  }

  // Validate uniform schema.
  const refColumns = (sources[0] as SegmentReader).columns;
  if (refColumns.length === 0) {
    throw new RangeError('compactSegments: first segment has no columns');
  }
  for (let si = 1; si < sources.length; si++) {
    const cols = (sources[si] as SegmentReader).columns;
    assertSchemaCompatible(refColumns, cols, si);
  }

  // Build a MemTable using the shared schema.
  const mt = new MemTable({
    schema: refColumns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    ...(options.pageRows !== undefined ? { pageRows: options.pageRows } : {}),
    // Disable flush triggers — we want to ingest everything without
    // shouldFlush() ever being meaningfully called. The caller drives
    // the lifecycle directly via buildSegment().
    maxRows: Number.POSITIVE_INFINITY,
    maxByteSize: Number.POSITIVE_INFINITY,
    maxAgeMs: Number.POSITIVE_INFINITY,
  });

  // For each source segment, walk its pages page-by-page in column
  // order. We feed entire decoded pages to addBatch — one buffer
  // pre-grow + memcpy per (segment, column, page).
  const colIds = refColumns.map((c) => c.id);
  const colTypes = new Map<number, ColumnTypeIdValue>();
  for (const c of refColumns) colTypes.set(c.id, c.type);

  for (const src of sources) {
    const colMeta = new Map<number, ColumnMetadata>();
    for (const c of src.columns) colMeta.set(c.id, c);
    const ref = colMeta.get(colIds[0] as number) as ColumnMetadata;
    const pageCount = ref.pages.length;
    for (let pi = 0; pi < pageCount; pi++) {
      // All columns in a source segment share page boundaries
      // (enforced at write time); use the first column's page
      // row count as the batch row count.
      const rowCount = ref.pages[pi]?.rowCount ?? 0;
      if (rowCount === 0) continue;
      const batch = new Map<number, ColumnArray>();
      for (const c of refColumns) {
        const encoded = src.readPage(c.id, pi);
        const decoded = decodePage(encoded, c.type);
        batch.set(c.id, decoded);
      }
      mt.addBatch(batch, rowCount);
    }
  }

  return encodeSegment(mt.buildSegment());
}

function assertSchemaCompatible(
  ref: readonly ColumnMetadata[],
  other: readonly ColumnMetadata[],
  sourceIndex: number,
): void {
  if (ref.length !== other.length) {
    throw new SchemaMismatchError(
      `compactSegments: segment ${sourceIndex} has ${other.length} columns, expected ${ref.length}`,
    );
  }
  for (let i = 0; i < ref.length; i++) {
    const r = ref[i] as ColumnMetadata;
    const o = other[i] as ColumnMetadata;
    if (r.id !== o.id) {
      throw new SchemaMismatchError(
        `compactSegments: segment ${sourceIndex} column ${i} id ${o.id} != ref ${r.id}`,
      );
    }
    if (r.name !== o.name) {
      throw new SchemaMismatchError(
        `compactSegments: segment ${sourceIndex} column ${i} name "${o.name}" != ref "${r.name}"`,
      );
    }
    if (r.type !== o.type) {
      throw new SchemaMismatchError(
        `compactSegments: segment ${sourceIndex} column ${i} type ${o.type} != ref ${r.type}`,
      );
    }
  }
}
