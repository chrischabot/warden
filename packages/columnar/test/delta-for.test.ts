import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  DeltaForOverflowError,
  decodeDeltaForInt32,
  encodeDeltaForInt32,
} from '../src/encodings/delta-for';
import { EncodingTag } from '../src/types';

const HEADER_LEN = 17; // i32 first + f64 min_delta + u8 bits + u32 count

describe('encodeDeltaForInt32 / decodeDeltaForInt32 — round trip', () => {
  test('empty', () => {
    const e = encodeDeltaForInt32([]);
    expect(e.tag).toBe(EncodingTag.DeltaForInt);
    expect(e.count).toBe(0);
    expect(decodeDeltaForInt32(e.bytes)).toEqual(new Int32Array(0));
  });

  test('single value', () => {
    const e = encodeDeltaForInt32([42]);
    expect(e.count).toBe(1);
    const decoded = decodeDeltaForInt32(e.bytes);
    expect(decoded.length).toBe(1);
    expect(decoded[0]).toBe(42);
  });

  test('arithmetic progression (bits = 0)', () => {
    const values: number[] = [];
    for (let i = 0; i < 100; i++) values.push(1000 + i * 7);
    const e = encodeDeltaForInt32(values);
    // All deltas equal → bits=0 → packed payload empty → header only.
    expect(e.bytes.byteLength).toBe(HEADER_LEN);
    expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual(values);
  });

  test('monotone non-constant', () => {
    const values = [100, 105, 110, 120, 125, 200, 205];
    const e = encodeDeltaForInt32(values);
    expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual(values);
  });

  test('non-monotone (mixed up/down) within small range', () => {
    const values = [1000, 1010, 1005, 1020, 1015, 1030];
    const e = encodeDeltaForInt32(values);
    expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual(values);
  });

  test('large monotone values fit when deltas are small', () => {
    const start = 1_000_000;
    const values: number[] = [];
    for (let i = 0; i < 50; i++) values.push(start + i * 1000);
    const e = encodeDeltaForInt32(values);
    expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual(values);
  });
});

describe('encodeDeltaForInt32 — overflow', () => {
  test('rejects when delta range exceeds 31 bits', () => {
    // Two distinct deltas with a span > 2^31:
    //   d1 = 2147483647 - 0           = 2147483647
    //   d2 = -2147483648 - 2147483647 = -4294967295
    //   range = d1 - d2 = 6442450942 → needs 33 bits → throw.
    expect(() => encodeDeltaForInt32([0, 2147483647, -2147483648])).toThrow(DeltaForOverflowError);
  });

  test('two values never overflow (single delta, range=0)', () => {
    // INT32_MIN → INT32_MAX is a single huge delta but the range
    // across deltas is 0, so it encodes fine with bits=0.
    const e = encodeDeltaForInt32([-2147483648, 2147483647]);
    expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual([-2147483648, 2147483647]);
  });

  test('mixed-direction extremes — properly rejected as overflow', () => {
    // INT32_MAX → INT32_MIN → INT32_MAX
    //   d1 = -4294967295, d2 = +4294967295, range = 8589934590 → bits=33.
    // Confirm we reject rather than accept-and-wrap.
    expect(() => encodeDeltaForInt32([2147483647, -2147483648, 2147483647])).toThrow(
      DeltaForOverflowError,
    );
  });
});

describe('encodeDeltaForInt32 — min_delta storage width', () => {
  // These cases exercise the f64 min_delta wire-format directly.
  // Under the previous i32 min_delta storage they round-tripped
  // only by accident of two's-complement wrap; here they must
  // round-trip by design.

  test('two values: single delta of magnitude > INT32_MAX', () => {
    // d1 = 4_294_967_295 → does not fit i32.
    const e = encodeDeltaForInt32([-2147483648, 2147483647]);
    expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual([-2147483648, 2147483647]);
  });

  test('two values: single delta with magnitude > INT32_MAX (negative direction)', () => {
    // d1 = -2_147_483_649 → magnitude exceeds INT32_MAX, fits f64
    // but NOT i32. With the old wire format minDelta would wrap to
    // a positive int32; with the new f64 storage it round-trips
    // exactly.
    const e = encodeDeltaForInt32([1, -2147483648]);
    expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual([1, -2147483648]);
  });

  test('three values with minDelta at exact INT32_MIN boundary', () => {
    // values: [INT32_MAX, -1, -2]
    //   d1 = -2147483648 (= INT32_MIN exactly), d2 = -1
    //   minDelta = -2147483648 (boundary case for i32),
    //   range = 2147483647 → bits = 31 → packed exactly to the cap.
    // Demonstrates that the 31-bit cap with boundary minDelta works.
    const values = [2147483647, -1, -2];
    const e = encodeDeltaForInt32(values);
    expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual(values);
  });

  test('two values with minDelta strictly below INT32_MIN', () => {
    // d = -2_147_483_649 < INT32_MIN. Only encodable because
    // min_delta is stored as f64.
    const v0 = 1;
    const v1 = -2147483648; // INT32_MIN
    const values = [v0, v1];
    const e = encodeDeltaForInt32(values);
    const decoded = decodeDeltaForInt32(e.bytes);
    expect(Array.from(decoded)).toEqual(values);
    // Confirm min_delta is what we expect by reading the f64 field
    // directly off the wire (offset 4, 8 bytes).
    const dv = new DataView(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength);
    const storedMinDelta = dv.getFloat64(4, true);
    expect(storedMinDelta).toBe(v1 - v0);
    expect(storedMinDelta).toBe(-2147483649);
  });
});

describe('decodeDeltaForInt32 — errors', () => {
  test('truncated header', () => {
    expect(() => decodeDeltaForInt32(new Uint8Array(5))).toThrow(RangeError);
  });
});

describe('property: arbitrary near-monotone columns round-trip', () => {
  test('round trip with bounded deltas', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(fc.integer({ min: -1000, max: 1000 }), {
          minLength: 0,
          maxLength: 256,
        }),
        (start, deltas) => {
          const values: number[] = [start];
          for (const d of deltas) {
            const next = (values[values.length - 1] as number) + d;
            values.push(next);
          }
          const e = encodeDeltaForInt32(values);
          expect(Array.from(decodeDeltaForInt32(e.bytes))).toEqual(values);
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
