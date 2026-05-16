import { describe, expect, test } from 'bun:test';
import {
  ColumnTypeId,
  decodeDeltaForInt32,
  decodeRawFloat64,
  decodeRawInt32,
  decodeRawInt64,
  decodeRawUint32,
  decodeStringDictionary,
  encodeSegment,
  MemTable,
  SegmentReader,
} from '../src/index';
import { EncodingTag } from '../src/types';

describe('MemTable — basic admission', () => {
  test('addRow appends and rowCount tracks', () => {
    const mt = new MemTable({
      schema: [
        { id: 1, name: 'a', type: ColumnTypeId.Int32 },
        { id: 2, name: 'b', type: ColumnTypeId.String },
      ],
    });
    expect(mt.rowCount).toBe(0);
    expect(mt.isEmpty()).toBe(true);
    mt.addRow([10, 'x']);
    mt.addRow([20, 'y']);
    mt.addRow([30, 'z']);
    expect(mt.rowCount).toBe(3);
    expect(mt.isEmpty()).toBe(false);
  });

  test('addRow rejects wrong arity', () => {
    const mt = new MemTable({
      schema: [
        { id: 1, name: 'a', type: ColumnTypeId.Int32 },
        { id: 2, name: 'b', type: ColumnTypeId.Int32 },
      ],
    });
    expect(() => mt.addRow([1] as readonly number[])).toThrow(RangeError);
    expect(() => mt.addRow([1, 2, 3] as readonly number[])).toThrow(RangeError);
  });

  test('empty schema rejected', () => {
    expect(
      () =>
        new MemTable({
          schema: [],
        }),
    ).toThrow(RangeError);
  });

  test('reset clears all buffers', () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'a', type: ColumnTypeId.Int32 }],
    });
    mt.addRow([100]);
    mt.addRow([200]);
    expect(mt.rowCount).toBe(2);
    mt.reset();
    expect(mt.rowCount).toBe(0);
    expect(mt.isEmpty()).toBe(true);
  });
});

describe('MemTable — flush triggers', () => {
  test('shouldFlush true when maxRows exceeded', () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'a', type: ColumnTypeId.Int32 }],
      maxRows: 3,
    });
    expect(mt.shouldFlush()).toBe(false);
    mt.addRow([1]);
    mt.addRow([2]);
    expect(mt.shouldFlush()).toBe(false);
    mt.addRow([3]);
    expect(mt.shouldFlush()).toBe(true);
  });

  test('shouldFlush true when byteSize exceeded', () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'a', type: ColumnTypeId.Int32 }],
      maxByteSize: 16, // 4 int32 = 16 bytes
    });
    mt.addRow([1]);
    mt.addRow([2]);
    mt.addRow([3]);
    expect(mt.shouldFlush()).toBe(false);
    mt.addRow([4]);
    expect(mt.shouldFlush()).toBe(true);
  });

  test('shouldFlush true when age exceeded', async () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'a', type: ColumnTypeId.Int32 }],
      maxAgeMs: 10,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(mt.shouldFlush()).toBe(true);
  });
});

describe('MemTable → encodeSegment → SegmentReader — round trip', () => {
  test('three numeric and string columns over multiple pages', () => {
    const mt = new MemTable({
      schema: [
        { id: 1, name: 'timestamp', type: ColumnTypeId.Int32 },
        { id: 2, name: 'platform', type: ColumnTypeId.String },
        { id: 3, name: 'latency', type: ColumnTypeId.Float64 },
      ],
      pageRows: 4,
    });
    const platforms = ['javascript', 'python', 'rust', 'go', 'swift'];
    const totalRows = 10;
    const expectedTs: number[] = [];
    const expectedPlat: string[] = [];
    const expectedLat: number[] = [];
    for (let i = 0; i < totalRows; i++) {
      const ts = 1000 + i * 100;
      const plat = platforms[i % platforms.length] as string;
      const lat = 0.01 * i;
      mt.addRow([ts, plat, lat]);
      expectedTs.push(ts);
      expectedPlat.push(plat);
      expectedLat.push(lat);
    }
    const spec = mt.buildSegment();
    const bytes = encodeSegment(spec);
    const reader = new SegmentReader(bytes);

    // Each column should have ceil(10 / pageRows=4) = 3 pages.
    expect(reader.columns.length).toBe(3);
    for (const col of reader.columns) {
      expect(col.pages.length).toBe(3);
      expect(col.pages[0]?.rowCount).toBe(4);
      expect(col.pages[1]?.rowCount).toBe(4);
      expect(col.pages[2]?.rowCount).toBe(2);
    }

    // Decode the timestamp column page by page.
    const ts: number[] = [];
    const tsCol = reader.column(1)!;
    for (let pi = 0; pi < tsCol.pages.length; pi++) {
      const page = reader.readPage(1, pi);
      // MemTable picks delta-FOR for int32; falls back to raw on overflow.
      const decoded =
        page.tag === EncodingTag.DeltaForInt
          ? decodeDeltaForInt32(page.bytes)
          : decodeRawInt32(page.bytes, page.count);
      for (let i = 0; i < decoded.length; i++) ts.push(decoded[i] as number);
    }
    expect(ts).toEqual(expectedTs);

    // Decode platform column.
    const plats: string[] = [];
    const platCol = reader.column(2)!;
    for (let pi = 0; pi < platCol.pages.length; pi++) {
      const page = reader.readPage(2, pi);
      const decoded = decodeStringDictionary(page.bytes, page.count);
      for (const s of decoded) plats.push(s);
    }
    expect(plats).toEqual(expectedPlat);

    // Decode latency column.
    const lats: number[] = [];
    const latCol = reader.column(3)!;
    for (let pi = 0; pi < latCol.pages.length; pi++) {
      const page = reader.readPage(3, pi);
      const decoded = decodeRawFloat64(page.bytes, page.count);
      for (let i = 0; i < decoded.length; i++) lats.push(decoded[i] as number);
    }
    expect(lats).toEqual(expectedLat);
  });

  test('int64 timestamps round trip', () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'ts_ns', type: ColumnTypeId.Int64 }],
      pageRows: 100,
    });
    const values: bigint[] = [];
    for (let i = 0; i < 50; i++) {
      const v = BigInt(1_700_000_000_000) + BigInt(i) * 1_000_000n;
      values.push(v);
      mt.addRow([v]);
    }
    const bytes = encodeSegment(mt.buildSegment());
    const reader = new SegmentReader(bytes);
    const page = reader.readPage(1, 0);
    const decoded = decodeRawInt64(page.bytes, page.count);
    expect(decoded.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(decoded[i]).toBe(values[i] as bigint);
    }
  });

  test('uint32 column round trips', () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'count', type: ColumnTypeId.Uint32 }],
    });
    const vs = [0, 1, 0xffffffff, 12345];
    for (const v of vs) mt.addRow([v]);
    const bytes = encodeSegment(mt.buildSegment());
    const reader = new SegmentReader(bytes);
    const page = reader.readPage(1, 0);
    const decoded = decodeRawUint32(page.bytes, page.count);
    expect(Array.from(decoded)).toEqual(vs);
  });
});

describe('MemTable — int32 encoding fallback', () => {
  test('overflowing delta-FOR falls back to raw', () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'mixed', type: ColumnTypeId.Int32 }],
    });
    // Three-value sequence whose delta range exceeds 31 bits.
    mt.addRow([0]);
    mt.addRow([2147483647]);
    mt.addRow([-2147483648]);
    const bytes = encodeSegment(mt.buildSegment());
    const reader = new SegmentReader(bytes);
    const page = reader.readPage(1, 0);
    expect(page.tag).toBe(EncodingTag.Raw);
    const decoded = decodeRawInt32(page.bytes, page.count);
    expect(Array.from(decoded)).toEqual([0, 2147483647, -2147483648]);
  });

  test('monotone int32 uses delta-FOR', () => {
    const mt = new MemTable({
      schema: [{ id: 1, name: 'mono', type: ColumnTypeId.Int32 }],
    });
    for (let i = 0; i < 100; i++) mt.addRow([1000 + i * 7]);
    const bytes = encodeSegment(mt.buildSegment());
    const reader = new SegmentReader(bytes);
    const page = reader.readPage(1, 0);
    expect(page.tag).toBe(EncodingTag.DeltaForInt);
  });
});

describe('MemTable — zonemaps populated', () => {
  test('numeric columns carry zonemap; string columns do not', () => {
    const mt = new MemTable({
      schema: [
        { id: 1, name: 'i', type: ColumnTypeId.Int32 },
        { id: 2, name: 's', type: ColumnTypeId.String },
      ],
    });
    for (let i = 0; i < 5; i++) mt.addRow([i * 10, `s${i}`]);
    const bytes = encodeSegment(mt.buildSegment());
    const reader = new SegmentReader(bytes);
    expect(reader.column(1)?.pages[0]?.zonemap).toEqual({ min: 0, max: 40 });
    expect(reader.column(2)?.pages[0]?.zonemap).toBeUndefined();
  });
});
