import { describe, expect, test } from 'bun:test';
import {
  ColumnTypeId,
  collect,
  compactSegments,
  encodeSegment,
  MemTable,
  query,
  SchemaMismatchError,
  SegmentReader,
} from '../src/index';

function makeSegment(
  rows: ReadonlyArray<readonly [number, string, number]>,
  pageRows = 4,
): SegmentReader {
  const mt = new MemTable({
    schema: [
      { id: 1, name: 'ts', type: ColumnTypeId.Int32 },
      { id: 2, name: 'env', type: ColumnTypeId.String },
      { id: 3, name: 'lat', type: ColumnTypeId.Float64 },
    ],
    pageRows,
  });
  for (const r of rows) mt.addRow([r[0], r[1], r[2]]);
  return new SegmentReader(encodeSegment(mt.buildSegment()));
}

describe('compactSegments — basics', () => {
  test('empty input throws', () => {
    expect(() => compactSegments([])).toThrow(RangeError);
  });

  test('single-segment input returns the source bytes unchanged', () => {
    const src = makeSegment([[1, 'a', 0.1]]);
    const out = compactSegments([src]);
    expect(out).toBe(src.bytes);
  });
});

describe('compactSegments — merge correctness', () => {
  test('two segments concatenate in source order, row order preserved', () => {
    const seg1 = makeSegment([
      [10, 'prod', 0.1],
      [20, 'prod', 0.2],
      [30, 'dev', 0.3],
    ]);
    const seg2 = makeSegment([
      [40, 'staging', 0.4],
      [50, 'prod', 0.5],
    ]);
    const merged = new SegmentReader(compactSegments([seg1, seg2]));
    const result = collect(query(merged, { columns: [1, 2, 3] }));
    expect(result.length).toBe(5);
    expect(result.columns.get(1)).toEqual([10, 20, 30, 40, 50]);
    expect(result.columns.get(2)).toEqual(['prod', 'prod', 'dev', 'staging', 'prod']);
    expect((result.columns.get(3) as number[]).map((v) => Math.round(v * 10))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  test('three segments stitch through multi-page boundaries', () => {
    const seg1 = makeSegment(
      Array.from({ length: 10 }, (_, i) => [1000 + i, `e${i}`, i * 0.1] as const),
    );
    const seg2 = makeSegment(
      Array.from({ length: 7 }, (_, i) => [2000 + i, `f${i}`, i * 0.2] as const),
    );
    const seg3 = makeSegment(
      Array.from({ length: 12 }, (_, i) => [3000 + i, `g${i}`, i * 0.3] as const),
    );
    const merged = new SegmentReader(compactSegments([seg1, seg2, seg3]));
    const result = collect(query(merged, { columns: [1] }));
    expect(result.length).toBe(29);
    const tsValues = result.columns.get(1) as number[];
    // First 10 entries are seg1's ts values.
    expect(tsValues.slice(0, 10)).toEqual([
      1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009,
    ]);
    // Next 7 are seg2's.
    expect(tsValues.slice(10, 17)).toEqual([2000, 2001, 2002, 2003, 2004, 2005, 2006]);
    // Final 12 are seg3's.
    expect(tsValues.slice(17)).toEqual([
      3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 3011,
    ]);
  });

  test('merged page count reflects new pageRows', () => {
    // Input segments built with pageRows=4 → each has 3 pages of 4 rows + leftovers.
    const seg1 = makeSegment(
      Array.from({ length: 10 }, (_, i) => [i, 'x', 0] as const),
      4,
    );
    const seg2 = makeSegment(
      Array.from({ length: 10 }, (_, i) => [100 + i, 'x', 0] as const),
      4,
    );
    // Compact with larger pageRows=8 → expect ceil(20/8) = 3 pages.
    const merged = new SegmentReader(compactSegments([seg1, seg2], { pageRows: 8 }));
    expect(merged.column(1)?.pages.length).toBe(3);
    expect(merged.column(1)?.pages[0]?.rowCount).toBe(8);
    expect(merged.column(1)?.pages[1]?.rowCount).toBe(8);
    expect(merged.column(1)?.pages[2]?.rowCount).toBe(4);
  });

  test('zonemaps recomputed on merged pages', () => {
    const seg1 = makeSegment([
      [10, 'x', 0],
      [20, 'x', 0],
      [30, 'x', 0],
    ]);
    const seg2 = makeSegment([
      [40, 'x', 0],
      [50, 'x', 0],
      [60, 'x', 0],
    ]);
    const merged = new SegmentReader(compactSegments([seg1, seg2], { pageRows: 100 }));
    expect(merged.column(1)?.pages[0]?.zonemap).toEqual({ min: 10, max: 60 });
  });
});

describe('compactSegments — schema validation', () => {
  test('rejects column-count mismatch', () => {
    const sameSchemaSegment = makeSegment([[1, 'a', 0.1]]);
    // Build a second segment with a different schema.
    const mt = new MemTable({
      schema: [
        { id: 1, name: 'ts', type: ColumnTypeId.Int32 },
        { id: 2, name: 'env', type: ColumnTypeId.String },
      ],
    });
    mt.addRow([1, 'a']);
    const differentSchemaSegment = new SegmentReader(encodeSegment(mt.buildSegment()));
    expect(() => compactSegments([sameSchemaSegment, differentSchemaSegment])).toThrow(
      SchemaMismatchError,
    );
  });

  test('rejects column-type mismatch', () => {
    const mt1 = new MemTable({
      schema: [{ id: 1, name: 'col', type: ColumnTypeId.Int32 }],
    });
    mt1.addRow([1]);
    const seg1 = new SegmentReader(encodeSegment(mt1.buildSegment()));

    const mt2 = new MemTable({
      schema: [{ id: 1, name: 'col', type: ColumnTypeId.Float64 }],
    });
    mt2.addRow([1]);
    const seg2 = new SegmentReader(encodeSegment(mt2.buildSegment()));

    expect(() => compactSegments([seg1, seg2])).toThrow(SchemaMismatchError);
  });

  test('rejects column-name mismatch', () => {
    const mt1 = new MemTable({
      schema: [{ id: 1, name: 'a', type: ColumnTypeId.Int32 }],
    });
    mt1.addRow([1]);
    const seg1 = new SegmentReader(encodeSegment(mt1.buildSegment()));

    const mt2 = new MemTable({
      schema: [{ id: 1, name: 'b', type: ColumnTypeId.Int32 }],
    });
    mt2.addRow([1]);
    const seg2 = new SegmentReader(encodeSegment(mt2.buildSegment()));

    expect(() => compactSegments([seg1, seg2])).toThrow(SchemaMismatchError);
  });
});

describe('compactSegments — large input', () => {
  test('compacts 8 segments of 1000 rows into a single segment of 8000 rows', () => {
    const segs: SegmentReader[] = [];
    for (let s = 0; s < 8; s++) {
      const rows: Array<readonly [number, string, number]> = [];
      for (let i = 0; i < 1000; i++) {
        rows.push([s * 10000 + i, `s${s}_e${i}`, i * 0.01] as const);
      }
      segs.push(makeSegment(rows, 256));
    }
    const merged = new SegmentReader(compactSegments(segs, { pageRows: 2048 }));
    const result = collect(query(merged, { columns: [1] }));
    expect(result.length).toBe(8000);
    // Spot-check that source-then-row order is preserved.
    expect((result.columns.get(1) as number[])[0]).toBe(0);
    expect((result.columns.get(1) as number[])[999]).toBe(999);
    expect((result.columns.get(1) as number[])[1000]).toBe(10000);
    expect((result.columns.get(1) as number[])[7999]).toBe(70999);
  });
});
