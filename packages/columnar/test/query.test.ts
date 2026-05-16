import { describe, expect, test } from 'bun:test';
import type { ColumnArray, Predicate } from '../src/index';
import {
  ColumnTypeId,
  collect,
  encodeSegment,
  filter,
  limit,
  MemTable,
  project,
  query,
  SegmentReader,
  scan,
} from '../src/index';

function buildReader(
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

describe('scan — yields one batch per page', () => {
  test('three pages of three columns', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 10; i++) rows.push([1000 + i, `e${i}`, i * 0.1] as const);
    const reader = buildReader(rows);
    const batches = [...scan(reader, [1, 2, 3])];
    expect(batches.length).toBe(3);
    expect(batches[0]?.length).toBe(4);
    expect(batches[1]?.length).toBe(4);
    expect(batches[2]?.length).toBe(2);
  });

  test('rejects unknown column', () => {
    const reader = buildReader([[1, 'a', 0.1]]);
    expect(() => [...scan(reader, [999])]).toThrow(/not present/);
  });
});

describe('filter — numeric', () => {
  test('selects rows where ts >= threshold', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 20; i++) rows.push([100 + i * 10, `e${i}`, i] as const);
    const reader = buildReader(rows);
    const result = collect(
      query(reader, {
        columns: [1, 2],
        filter: { kind: 'num', column: 1, op: 'gte', value: 200 },
      }),
    );
    expect(result.length).toBe(10);
    const tsValues = result.columns.get(1) as number[];
    for (const v of tsValues) expect(v).toBeGreaterThanOrEqual(200);
  });

  test('lt narrows to early rows', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 20; i++) rows.push([100 + i * 10, `e${i}`, i] as const);
    const reader = buildReader(rows);
    const result = collect(
      query(reader, {
        columns: [1],
        filter: { kind: 'num', column: 1, op: 'lt', value: 150 },
      }),
    );
    expect(result.length).toBe(5);
  });

  test('eq picks exact match', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 20; i++) rows.push([100 + i * 10, `e${i}`, i] as const);
    const reader = buildReader(rows);
    const result = collect(
      query(reader, {
        columns: [1, 2],
        filter: { kind: 'num', column: 1, op: 'eq', value: 170 },
      }),
    );
    expect(result.length).toBe(1);
    expect((result.columns.get(2) as string[])[0]).toBe('e7');
  });
});

describe('filter — string', () => {
  test('eq', () => {
    const rows: Array<readonly [number, string, number]> = [
      [1, 'prod', 0.1],
      [2, 'dev', 0.2],
      [3, 'prod', 0.3],
      [4, 'staging', 0.4],
      [5, 'prod', 0.5],
    ];
    const reader = buildReader(rows);
    const result = collect(
      query(reader, {
        columns: [1, 2],
        filter: { kind: 'str', column: 2, op: 'eq', values: ['prod'] },
      }),
    );
    expect(result.length).toBe(3);
    expect(result.columns.get(1)).toEqual([1, 3, 5]);
  });

  test('in matches a set', () => {
    const rows: Array<readonly [number, string, number]> = [
      [1, 'prod', 0.1],
      [2, 'dev', 0.2],
      [3, 'staging', 0.3],
      [4, 'qa', 0.4],
    ];
    const reader = buildReader(rows);
    const result = collect(
      query(reader, {
        columns: [1],
        filter: { kind: 'str', column: 2, op: 'in', values: ['prod', 'staging'] },
      }),
    );
    expect(result.length).toBe(2);
    expect(result.columns.get(1)).toEqual([1, 3]);
  });
});

describe('filter — AND / OR', () => {
  test('AND of two predicates', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 20; i++) {
      rows.push([100 + i * 10, i % 2 === 0 ? 'prod' : 'dev', i] as const);
    }
    const reader = buildReader(rows);
    const pred: Predicate = {
      kind: 'and',
      predicates: [
        { kind: 'num', column: 1, op: 'gte', value: 150 },
        { kind: 'str', column: 2, op: 'eq', values: ['prod'] },
      ],
    };
    const result = collect(query(reader, { columns: [1], filter: pred }));
    expect((result.columns.get(1) as number[]).length).toBe(7);
  });

  test('OR of two predicates', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 10; i++) rows.push([100 + i, 'x', 0] as const);
    const reader = buildReader(rows);
    const pred: Predicate = {
      kind: 'or',
      predicates: [
        { kind: 'num', column: 1, op: 'lt', value: 103 },
        { kind: 'num', column: 1, op: 'gte', value: 108 },
      ],
    };
    const result = collect(query(reader, { columns: [1], filter: pred }));
    expect(result.length).toBe(5);
    expect(result.columns.get(1)).toEqual([100, 101, 102, 108, 109]);
  });
});

describe('predicate pushdown — zonemap page-skip', () => {
  test('pages outside the predicate range are not even read', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 40; i++) rows.push([1000 + i * 10, 'x', 0] as const);
    const reader = buildReader(rows, 4);
    expect(reader.column(1)?.pages.length).toBe(10);
    const page0 = reader.column(1)?.pages[0]?.zonemap;
    expect(page0).toEqual({ min: 1000, max: 1030 });
    const pred: Predicate = { kind: 'num', column: 1, op: 'gte', value: 1300 };
    const batches = [...scan(reader, [1], { skipFilter: pred })];
    // Pages whose zonemap.max >= 1300 survive page-skip:
    //   page 7 → [1280, 1310] ✓ ; page 8 → [1320, 1350] ✓ ; page 9 → [1360, 1390] ✓
    expect(batches.length).toBe(3);
  });

  test('filter on a column not projected still drives page-skip', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 40; i++) rows.push([1000 + i * 10, 'x', i * 0.01] as const);
    const reader = buildReader(rows, 4);
    // Project only column 2 (env) and filter on column 1 (ts).
    const result = collect(
      query(reader, {
        columns: [2],
        filter: { kind: 'num', column: 1, op: 'gte', value: 1380 },
      }),
    );
    expect(result.length).toBe(2);
    // The output should only contain the env column, not the
    // filter-only ts column we transparently scanned for predicate eval.
    expect([...result.columns.keys()]).toEqual([2]);
  });
});

describe('project + limit', () => {
  test('project drops columns', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 6; i++) rows.push([i, `e${i}`, i * 0.1] as const);
    const reader = buildReader(rows);
    const out = collect(project(scan(reader, [1, 2, 3]), [1]));
    expect(out.length).toBe(6);
    expect([...out.columns.keys()]).toEqual([1]);
  });

  test('limit truncates mid-batch', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 20; i++) rows.push([i, `e${i}`, 0] as const);
    const reader = buildReader(rows, 8);
    const out = collect(limit(scan(reader, [1]), 5));
    expect(out.length).toBe(5);
    expect(out.columns.get(1)).toEqual([0, 1, 2, 3, 4]);
  });

  test('limit 0 yields nothing', () => {
    const rows: Array<readonly [number, string, number]> = [[1, 'a', 0]];
    const reader = buildReader(rows);
    const out = collect(limit(scan(reader, [1]), 0));
    expect(out.length).toBe(0);
  });
});

describe('end-to-end Discover-shaped query', () => {
  test('filter + project + limit on a realistic mix', () => {
    const rows: Array<readonly [number, string, number]> = [];
    for (let i = 0; i < 100; i++) {
      const env = i % 3 === 0 ? 'prod' : i % 3 === 1 ? 'dev' : 'staging';
      rows.push([1_000_000 + i * 1000, env, 0.001 * i] as const);
    }
    const reader = buildReader(rows, 16);
    const result = collect(
      query(reader, {
        columns: [1, 3],
        filter: {
          kind: 'and',
          predicates: [
            { kind: 'str', column: 2, op: 'eq', values: ['prod'] },
            { kind: 'num', column: 1, op: 'gte', value: 1_050_000 },
          ],
        },
        limit: 5,
      }),
    );
    expect(result.length).toBe(5);
    for (const ts of result.columns.get(1) as number[]) {
      expect(ts).toBeGreaterThanOrEqual(1_050_000);
    }
    // env (column 2) was a filter-only column; should NOT appear in projection.
    expect(result.columns.has(2)).toBe(false);
  });
});

describe('big-int column predicates', () => {
  test('filters int64 timestamps with bigint target', () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'ts_ns', type: ColumnTypeId.Int64 }],
      pageRows: 8,
    });
    for (let i = 0n; i < 20n; i++) mt.addRow([1_700_000_000_000n + i * 1_000_000n]);
    const reader = new SegmentReader(encodeSegment(mt.buildSegment()));
    const result = collect(
      query(reader, {
        columns: [1],
        filter: {
          kind: 'bigint',
          column: 1,
          op: 'gte',
          value: 1_700_010_000_000n,
        },
      }),
    );
    expect(result.length).toBe(10);
  });
});

function _verifyExports(): ColumnArray | undefined {
  return undefined;
}
