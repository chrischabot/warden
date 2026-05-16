import { describe, expect, test } from 'bun:test';
import { BloomFilter } from '@sr/hll-tdigest';
import {
  ColumnTypeId,
  decodeDeltaForInt32,
  decodeRawFloat64,
  decodeRleInt32,
  decodeStringDictionary,
  encodeDeltaForInt32,
  encodeRawFloat64,
  encodeRleInt32,
  encodeSegment,
  encodeStringDictionary,
  SegmentReader,
  zonemapForFloat64,
  zonemapForInt32,
} from '../src/index';

describe('Segment writer + reader — round trip', () => {
  test('multi-column, multi-page segment decodes column-by-column', () => {
    const ts1 = [1000, 1100, 1200, 1300];
    const ts2 = [1400, 1500, 1600, 1700];
    const plat1 = ['javascript', 'javascript', 'python', 'javascript'];
    const plat2 = ['python', 'javascript', 'python', 'java'];
    const lat1 = [0.05, 0.1, 0.12, 0.15];
    const lat2 = [0.2, 0.25, 0.3, 0.5];

    const segmentBytes = encodeSegment({
      columns: [
        {
          id: 0,
          name: 'timestamp',
          type: ColumnTypeId.Int32,
          pages: [
            {
              encoded: encodeDeltaForInt32(ts1),
              rowCount: ts1.length,
              zonemap: zonemapForInt32(ts1),
            },
            {
              encoded: encodeDeltaForInt32(ts2),
              rowCount: ts2.length,
              zonemap: zonemapForInt32(ts2),
            },
          ],
        },
        {
          id: 1,
          name: 'platform',
          type: ColumnTypeId.String,
          pages: [
            { encoded: encodeStringDictionary(plat1), rowCount: plat1.length },
            { encoded: encodeStringDictionary(plat2), rowCount: plat2.length },
          ],
        },
        {
          id: 2,
          name: 'latency_seconds',
          type: ColumnTypeId.Float64,
          pages: [
            {
              encoded: encodeRawFloat64(lat1),
              rowCount: lat1.length,
              zonemap: zonemapForFloat64(lat1),
            },
            {
              encoded: encodeRawFloat64(lat2),
              rowCount: lat2.length,
              zonemap: zonemapForFloat64(lat2),
            },
          ],
        },
      ],
    });

    const reader = new SegmentReader(segmentBytes);
    expect(reader.columns.length).toBe(3);

    // Column 0: timestamp (Int32 / delta-FOR)
    const tsCol = reader.column(0)!;
    expect(tsCol.name).toBe('timestamp');
    expect(tsCol.type).toBe(ColumnTypeId.Int32);
    expect(tsCol.pages.length).toBe(2);
    const tsPage0 = reader.readPage(0, 0);
    expect(Array.from(decodeDeltaForInt32(tsPage0.bytes))).toEqual(ts1);
    const tsPage1 = reader.readPage(0, 1);
    expect(Array.from(decodeDeltaForInt32(tsPage1.bytes))).toEqual(ts2);
    expect(tsCol.pages[0]?.zonemap).toEqual({ min: 1000, max: 1300 });
    expect(tsCol.pages[1]?.zonemap).toEqual({ min: 1400, max: 1700 });

    // Column 1: platform (String / dictionary)
    const platCol = reader.column(1)!;
    expect(platCol.name).toBe('platform');
    expect(platCol.type).toBe(ColumnTypeId.String);
    expect(platCol.pages[0]?.zonemap).toBeUndefined();
    const platPage0 = reader.readPage(1, 0);
    expect(decodeStringDictionary(platPage0.bytes, plat1.length)).toEqual(plat1);
    const platPage1 = reader.readPage(1, 1);
    expect(decodeStringDictionary(platPage1.bytes, plat2.length)).toEqual(plat2);

    // Column 2: latency (Float64 / raw)
    const latCol = reader.column(2)!;
    expect(latCol.type).toBe(ColumnTypeId.Float64);
    const latPage0 = reader.readPage(2, 0);
    expect(Array.from(decodeRawFloat64(latPage0.bytes, lat1.length))).toEqual(lat1);
    expect(latCol.pages[0]?.zonemap).toEqual({ min: 0.05, max: 0.15 });
  });

  test('RLE-encoded column round trips through the segment', () => {
    const values = [1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4];
    const segmentBytes = encodeSegment({
      columns: [
        {
          id: 7,
          name: 'project_id',
          type: ColumnTypeId.Int32,
          pages: [
            {
              encoded: encodeRleInt32(values),
              rowCount: values.length,
              zonemap: zonemapForInt32(values),
            },
          ],
        },
      ],
    });
    const reader = new SegmentReader(segmentBytes);
    const page = reader.readPage(7, 0);
    expect(Array.from(decodeRleInt32(page.bytes, values.length))).toEqual(values);
    expect(reader.column(7)?.pages[0]?.zonemap).toEqual({ min: 1, max: 4 });
  });
});

describe('Segment writer + reader — bloom filters', () => {
  test('bloom round-trips through the footer', () => {
    const items: string[] = [];
    for (let i = 0; i < 200; i++) items.push(`event_${i}`);
    const bloom = BloomFilter.withFpr(items.length, 0.01);
    for (const it of items) bloom.add(it);

    const segmentBytes = encodeSegment({
      columns: [
        {
          id: 0,
          name: 'event_id',
          type: ColumnTypeId.String,
          pages: [
            {
              encoded: encodeStringDictionary(items),
              rowCount: items.length,
              bloom: bloom.serialize(),
            },
          ],
        },
      ],
    });

    const reader = new SegmentReader(segmentBytes);
    const pageMd = reader.columns[0]?.pages[0];
    expect(pageMd?.bloom).toBeDefined();
    const recovered = BloomFilter.deserialize(pageMd!.bloom!);
    for (const it of items) {
      expect(recovered.has(it)).toBe(true);
    }
  });

  test('mixed pages with and without bloom', () => {
    const blm = BloomFilter.withFpr(50, 0.01);
    for (let i = 0; i < 50; i++) blm.add(`x_${i}`);

    const seg = encodeSegment({
      columns: [
        {
          id: 0,
          name: 'col',
          type: ColumnTypeId.Int32,
          pages: [
            { encoded: encodeRleInt32([1, 1, 2, 2, 3]), rowCount: 5 },
            {
              encoded: encodeRleInt32([4, 4, 5, 5, 6]),
              rowCount: 5,
              bloom: blm.serialize(),
              zonemap: { min: 4, max: 6 },
            },
          ],
        },
      ],
    });
    const reader = new SegmentReader(seg);
    expect(reader.columns[0]?.pages[0]?.bloom).toBeUndefined();
    expect(reader.columns[0]?.pages[0]?.zonemap).toBeUndefined();
    expect(reader.columns[0]?.pages[1]?.bloom).toBeDefined();
    expect(reader.columns[0]?.pages[1]?.zonemap).toEqual({ min: 4, max: 6 });
  });
});

describe('SegmentReader — error handling', () => {
  test('rejects buffer that is too short', () => {
    expect(() => new SegmentReader(new Uint8Array(4))).toThrow(RangeError);
  });

  test('rejects bad magic', () => {
    const buf = new Uint8Array(64);
    expect(() => new SegmentReader(buf)).toThrow(/invalid magic/);
  });

  test('rejects truncated footer (footer length > buffer)', () => {
    const goodBytes = encodeSegment({
      columns: [
        {
          id: 0,
          name: 'x',
          type: ColumnTypeId.Int32,
          pages: [{ encoded: encodeRleInt32([1, 2, 3]), rowCount: 3 }],
        },
      ],
    });
    // Truncate to before footer.
    const truncated = goodBytes.subarray(0, goodBytes.byteLength - 10);
    expect(() => new SegmentReader(truncated)).toThrow();
  });
});

describe('SegmentReader — empty and edge cases', () => {
  test('segment with one column and one zero-row page (still valid)', () => {
    const seg = encodeSegment({
      columns: [
        {
          id: 0,
          name: 'empty',
          type: ColumnTypeId.Int32,
          pages: [{ encoded: encodeRleInt32([]), rowCount: 0 }],
        },
      ],
    });
    const reader = new SegmentReader(seg);
    expect(reader.columns.length).toBe(1);
    expect(reader.columns[0]?.pages[0]?.rowCount).toBe(0);
  });

  test('column with unicode name round-trips', () => {
    const seg = encodeSegment({
      columns: [
        {
          id: 1,
          name: '错误码',
          type: ColumnTypeId.Int32,
          pages: [{ encoded: encodeRleInt32([1, 1]), rowCount: 2 }],
        },
      ],
    });
    const reader = new SegmentReader(seg);
    expect(reader.column(1)?.name).toBe('错误码');
  });
});
