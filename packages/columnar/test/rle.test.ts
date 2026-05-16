import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { decodeRleInt32, encodeRleInt32 } from '../src/encodings/rle';
import { EncodingTag } from '../src/types';

describe('encodeRleInt32 / decodeRleInt32 — round trip', () => {
  test('single long run', () => {
    const values = new Array(1000).fill(42);
    const e = encodeRleInt32(values);
    expect(e.tag).toBe(EncodingTag.RunLength);
    expect(e.count).toBe(1000);
    expect(e.bytes.byteLength).toBe(8); // one (count, value) pair
    expect(Array.from(decodeRleInt32(e.bytes, 1000))).toEqual(values);
  });

  test('all distinct values (worst case)', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    const e = encodeRleInt32(values);
    expect(e.bytes.byteLength).toBe(8 * 8);
    expect(Array.from(decodeRleInt32(e.bytes, values.length))).toEqual(values);
  });

  test('mixed runs', () => {
    const values = [1, 1, 1, 2, 2, 3, 1, 1, 4, 4, 4, 4];
    const e = encodeRleInt32(values);
    // Runs: (3,1), (2,2), (1,3), (2,1), (4,4) = 5 pairs = 40 bytes
    expect(e.bytes.byteLength).toBe(40);
    expect(Array.from(decodeRleInt32(e.bytes, values.length))).toEqual(values);
  });

  test('empty input', () => {
    const e = encodeRleInt32([]);
    expect(e.count).toBe(0);
    expect(e.bytes.byteLength).toBe(0);
    expect(decodeRleInt32(e.bytes, 0)).toEqual(new Int32Array(0));
  });

  test('signed extremes', () => {
    const values = [-2147483648, -2147483648, 2147483647, 0];
    const e = encodeRleInt32(values);
    expect(Array.from(decodeRleInt32(e.bytes, values.length))).toEqual(values);
  });
});

describe('decodeRleInt32 — errors', () => {
  test('truncated pair throws', () => {
    expect(() => decodeRleInt32(new Uint8Array(4), 1)).toThrow(RangeError);
  });

  test('empty buffer with positive count throws', () => {
    expect(() => decodeRleInt32(new Uint8Array(0), 1)).toThrow(RangeError);
  });
});

describe('property: arbitrary int32 columns round-trip', () => {
  test('round trip', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -2147483648, max: 2147483647 }), {
          minLength: 0,
          maxLength: 256,
        }),
        (values) => {
          const e = encodeRleInt32(values);
          expect(Array.from(decodeRleInt32(e.bytes, values.length))).toEqual(values);
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });

  test('runs of equal values produce shorter output', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1024 }),
        fc.integer({ min: -1000, max: 1000 }),
        (n, v) => {
          const values = new Array(n).fill(v);
          const e = encodeRleInt32(values);
          expect(e.bytes.byteLength).toBe(8);
          return true;
        },
      ),
      { numRuns: 30 },
    );
  });
});
