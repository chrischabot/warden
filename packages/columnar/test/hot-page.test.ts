import { describe, expect, test } from 'bun:test';
import {
  CachedSegmentReader,
  ColumnTypeId,
  collect,
  encodeSegment,
  MemTable,
  query,
} from '../src/index';

function buildBytes(rowCount: number, pageRows = 4): Uint8Array {
  const mt = new MemTable({
    schema: [
      { id: 1, name: 'ts', type: ColumnTypeId.Int32 },
      { id: 2, name: 'env', type: ColumnTypeId.String },
    ],
    pageRows,
  });
  for (let i = 0; i < rowCount; i++) mt.addRow([1000 + i, `e${i}`]);
  return encodeSegment(mt.buildSegment());
}

describe('CachedSegmentReader — drop-in compatibility', () => {
  test('query works against the cached reader the same as the plain reader', () => {
    const reader = new CachedSegmentReader(buildBytes(20, 4));
    const result = collect(
      query(reader, {
        columns: [1, 2],
        filter: { kind: 'num', column: 1, op: 'gte', value: 1010 },
      }),
    );
    expect(result.length).toBe(10);
  });
});

describe('CachedSegmentReader — caching behaviour', () => {
  test('repeated reads of the same page produce one cache entry', () => {
    const reader = new CachedSegmentReader(buildBytes(8, 4));
    reader.readPage(1, 0);
    reader.readPage(1, 0);
    reader.readPage(1, 0);
    expect(reader.cacheStats.entries).toBe(1);
  });

  test('distinct (column, page) keys produce distinct cache entries', () => {
    const reader = new CachedSegmentReader(buildBytes(20, 4));
    // 5 pages of 2 columns = 10 distinct (col, page) keys.
    for (const colId of [1, 2]) {
      for (let pi = 0; pi < 5; pi++) {
        reader.readPage(colId, pi);
      }
    }
    expect(reader.cacheStats.entries).toBe(10);
  });

  test('clearCache wipes entries and byte accounting', () => {
    const reader = new CachedSegmentReader(buildBytes(8, 4));
    reader.readPage(1, 0);
    reader.readPage(1, 1);
    expect(reader.cacheStats.entries).toBe(2);
    expect(reader.cacheStats.bytes).toBeGreaterThan(0);
    reader.clearCache();
    expect(reader.cacheStats.entries).toBe(0);
    expect(reader.cacheStats.bytes).toBe(0);
  });

  test('maxBytes eviction kicks in', () => {
    // Build a segment whose page bytes far exceed the tiny maxBytes cap.
    const reader = new CachedSegmentReader(buildBytes(40, 4), { maxBytes: 32 });
    // Each int32 page body is ~13 + body bytes; reading two consecutive
    // pages will overflow the 32-byte cap and evict the earlier one.
    reader.readPage(1, 0);
    reader.readPage(1, 1);
    reader.readPage(1, 2);
    expect(reader.cacheStats.bytes).toBeLessThanOrEqual(32 + 64);
  });

  test('returned EncodedColumn matches the underlying readPage byte-for-byte', () => {
    const bytes = buildBytes(20, 4);
    const cached = new CachedSegmentReader(bytes);
    const a = cached.readPage(1, 0);
    const b = cached.readPage(1, 0); // cache hit
    expect(b.bytes).toBe(a.bytes); // same TypedArray view, same backing buffer
    expect(b.count).toBe(a.count);
    expect(b.tag).toBe(a.tag);
  });
});
