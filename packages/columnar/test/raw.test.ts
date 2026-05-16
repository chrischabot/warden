import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  decodeRawFloat64,
  decodeRawInt32,
  decodeRawInt64,
  decodeRawUint32,
  encodeRawFloat64,
  encodeRawInt32,
  encodeRawInt64,
  encodeRawUint32,
} from '../src/encodings/raw';
import { EncodingTag } from '../src/types';

describe('encodeRawInt32 — wire layout', () => {
  test('values are little-endian', () => {
    const e = encodeRawInt32([1, 256, -1]);
    expect(e.tag).toBe(EncodingTag.Raw);
    expect(e.count).toBe(3);
    // 1 = 01 00 00 00
    // 256 = 00 01 00 00
    // -1 = ff ff ff ff
    expect(Array.from(e.bytes)).toEqual([
      0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ]);
  });
});

describe('encodeRawInt32 / decodeRawInt32 — round trip', () => {
  test('empty', () => {
    const e = encodeRawInt32([]);
    expect(e.count).toBe(0);
    expect(e.bytes.byteLength).toBe(0);
    expect(decodeRawInt32(e.bytes, 0)).toEqual(new Int32Array(0));
  });

  test('typical values', () => {
    const values = [-2147483648, -1, 0, 1, 2147483647];
    const e = encodeRawInt32(values);
    expect(Array.from(decodeRawInt32(e.bytes, values.length))).toEqual(values);
  });

  test('rejects truncated buffer', () => {
    const e = encodeRawInt32([1, 2, 3]);
    expect(() => decodeRawInt32(e.bytes.subarray(0, 7), 3)).toThrow(RangeError);
  });

  test('property: arbitrary int32 arrays', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -2147483648, max: 2147483647 }), {
          minLength: 0,
          maxLength: 128,
        }),
        (values) => {
          const e = encodeRawInt32(values);
          expect(Array.from(decodeRawInt32(e.bytes, values.length))).toEqual(values);
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('encodeRawUint32 / decodeRawUint32 — round trip', () => {
  test('boundary values', () => {
    const values = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff];
    const e = encodeRawUint32(values);
    expect(Array.from(decodeRawUint32(e.bytes, values.length))).toEqual(values);
  });
});

describe('encodeRawInt64 / decodeRawInt64 — round trip', () => {
  test('boundary bigint values', () => {
    const values = [
      -(1n << 63n),
      -1n,
      0n,
      1n,
      (1n << 63n) - 1n,
      1_700_000_000_000n, // ms timestamp
    ];
    const e = encodeRawInt64(values);
    const decoded = decodeRawInt64(e.bytes, values.length);
    expect(decoded.length).toBe(values.length);
    for (let i = 0; i < values.length; i++) {
      expect(decoded[i]).toBe(values[i] as bigint);
    }
  });
});

describe('encodeRawFloat64 / decodeRawFloat64 — round trip', () => {
  test('typical and edge values', () => {
    const values = [0, -0, 1.5, -1.5, Number.MIN_VALUE, Number.MAX_VALUE, Math.PI];
    const e = encodeRawFloat64(values);
    const decoded = decodeRawFloat64(e.bytes, values.length);
    expect(decoded[0]).toBe(0);
    expect(Object.is(decoded[1], -0)).toBe(true);
    for (let i = 2; i < values.length; i++) {
      expect(decoded[i]).toBe(values[i] as number);
    }
  });

  test('NaN survives encode/decode (bit-identical)', () => {
    const e = encodeRawFloat64([Number.NaN]);
    const decoded = decodeRawFloat64(e.bytes, 1);
    expect(Number.isNaN(decoded[0] as number)).toBe(true);
  });

  test('infinities survive', () => {
    const values = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const e = encodeRawFloat64(values);
    const decoded = decodeRawFloat64(e.bytes, values.length);
    expect(decoded[0]).toBe(Number.POSITIVE_INFINITY);
    expect(decoded[1]).toBe(Number.NEGATIVE_INFINITY);
  });
});
