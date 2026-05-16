import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { BitReader, BitWriter } from '../src/bit-buffer';

describe('BitWriter / BitReader — round trips', () => {
  test('1-bit values across byte boundaries', () => {
    const values = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1];
    const bw = new BitWriter();
    for (const v of values) bw.writeBits(v, 1);
    const bytes = bw.finish();
    expect(bytes.byteLength).toBe(2);
    const br = new BitReader(bytes);
    const out = values.map(() => br.readBits(1));
    expect(out).toEqual(values);
  });

  test('3-bit values', () => {
    const values = [0, 1, 7, 5, 2, 6, 3, 4];
    const bw = new BitWriter();
    for (const v of values) bw.writeBits(v, 3);
    const bytes = bw.finish();
    expect(bytes.byteLength).toBe(Math.ceil(24 / 8));
    const br = new BitReader(bytes);
    const out = values.map(() => br.readBits(3));
    expect(out).toEqual(values);
  });

  test('mixed widths', () => {
    const bw = new BitWriter();
    bw.writeBits(0b101, 3);
    bw.writeBits(0b1110, 4);
    bw.writeBits(0xff, 8);
    bw.writeBits(0xdeadbeef, 32);
    const bytes = bw.finish();
    const br = new BitReader(bytes);
    expect(br.readBits(3)).toBe(0b101);
    expect(br.readBits(4)).toBe(0b1110);
    expect(br.readBits(8)).toBe(0xff);
    expect(br.readBits(32)).toBe(0xdeadbeef >>> 0);
  });

  test('32-bit values', () => {
    const values = [0, 1, 0xffffffff, 0x80000000, 0xdeadbeef];
    const bw = new BitWriter();
    for (const v of values) bw.writeBits(v >>> 0, 32);
    const bytes = bw.finish();
    const br = new BitReader(bytes);
    const out = values.map(() => br.readBits(32));
    expect(out).toEqual(values.map((v) => v >>> 0));
  });

  test('zero-bit write/read is a no-op', () => {
    const bw = new BitWriter();
    bw.writeBits(0, 0);
    bw.writeBits(0b11, 2);
    const bytes = bw.finish();
    const br = new BitReader(bytes);
    expect(br.readBits(0)).toBe(0);
    expect(br.readBits(2)).toBe(0b11);
  });
});

describe('BitWriter / BitReader — errors', () => {
  test('rejects n > 32', () => {
    const bw = new BitWriter();
    expect(() => bw.writeBits(0, 33)).toThrow(RangeError);
  });

  test('rejects negative n', () => {
    const bw = new BitWriter();
    expect(() => bw.writeBits(0, -1)).toThrow(RangeError);
  });

  test('reader throws on out-of-bits', () => {
    const br = new BitReader(new Uint8Array([0xff]));
    br.readBits(8);
    expect(() => br.readBits(1)).toThrow(RangeError);
  });
});

describe('property: round trip with arbitrary bit-width streams', () => {
  test('any sequence of (value, bits) round-trips', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .record({
              bits: fc.integer({ min: 1, max: 32 }),
            })
            .chain((spec) =>
              fc.record({
                bits: fc.constant(spec.bits),
                value: fc.integer({
                  min: 0,
                  max: 2 ** spec.bits - 1,
                }),
              }),
            ),
          { minLength: 0, maxLength: 64 },
        ),
        (specs) => {
          const bw = new BitWriter();
          for (const s of specs) bw.writeBits(s.value, s.bits);
          const bytes = bw.finish();
          const br = new BitReader(bytes);
          for (const s of specs) {
            expect(br.readBits(s.bits)).toBe(s.value >>> 0);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
