import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { decodeVlq, encodeVlq, VlqDecodeError } from '../src/vlq';

describe('decodeVlq — canonical cases', () => {
  // Hand-verified single-VLQ cases.
  const cases: ReadonlyArray<readonly [string, number]> = [
    ['A', 0],
    ['C', 1],
    ['D', -1],
    ['E', 2],
    ['F', -2],
    ['gB', 16],
    ['gC', 32],
  ];
  for (const [input, expected] of cases) {
    test(`decode "${input}" → ${expected}`, () => {
      const { value, nextPos } = decodeVlq(input, 0);
      expect(value).toBe(expected);
      expect(nextPos).toBe(input.length);
    });
  }
});

describe('decodeVlq — sequence', () => {
  test('reads consecutive VLQs from one string', () => {
    const s = 'A' + 'C' + 'D'; // 0, 1, -1
    let pos = 0;
    const r0 = decodeVlq(s, pos);
    expect(r0.value).toBe(0);
    pos = r0.nextPos;
    const r1 = decodeVlq(s, pos);
    expect(r1.value).toBe(1);
    pos = r1.nextPos;
    const r2 = decodeVlq(s, pos);
    expect(r2.value).toBe(-1);
    expect(r2.nextPos).toBe(s.length);
  });
});

describe('decodeVlq — errors', () => {
  test('empty input throws', () => {
    expect(() => decodeVlq('', 0)).toThrow(VlqDecodeError);
  });

  test('invalid base64 character throws', () => {
    expect(() => decodeVlq('!', 0)).toThrow(VlqDecodeError);
  });

  test('unterminated continuation throws', () => {
    // 'g' = 32 = continuation bit set, no follow-up digit.
    expect(() => decodeVlq('g', 0)).toThrow(VlqDecodeError);
  });
});

describe('encodeVlq — small values', () => {
  test('encode/decode round trip for small ints', () => {
    for (let v = -100; v <= 100; v++) {
      const enc = encodeVlq(v);
      const { value, nextPos } = decodeVlq(enc, 0);
      expect(value).toBe(v);
      expect(nextPos).toBe(enc.length);
    }
  });

  test('rejects non-integers', () => {
    expect(() => encodeVlq(1.5)).toThrow(RangeError);
  });
});

describe('encodeVlq / decodeVlq — large values round trip', () => {
  test('INT32 extremes round trip', () => {
    const extremes = [
      0,
      1,
      -1,
      2_147_483_647, // INT32_MAX
      -2_147_483_647, // -INT32_MAX (avoids -INT32_MIN edge)
      4_294_967_295, // UINT32_MAX
      -4_294_967_295,
    ];
    for (const v of extremes) {
      const enc = encodeVlq(v);
      const { value } = decodeVlq(enc, 0);
      expect(value).toBe(v);
    }
  });

  test('property: arbitrary 40-bit signed ints round trip', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -(2 ** 40), max: 2 ** 40 }),
        (v) => decodeVlq(encodeVlq(v), 0).value === v,
      ),
      { numRuns: 200 },
    );
  });
});
