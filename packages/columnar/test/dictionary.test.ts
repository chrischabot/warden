import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { decodeStringDictionary, encodeStringDictionary } from '../src/encodings/dictionary';
import { EncodingTag } from '../src/types';

describe('encodeStringDictionary — basic', () => {
  test('typical low-cardinality column', () => {
    const values = ['prod', 'prod', 'dev', 'prod', 'staging', 'dev', 'prod'];
    const e = encodeStringDictionary(values);
    expect(e.tag).toBe(EncodingTag.Dictionary);
    expect(e.count).toBe(7);
    const decoded = decodeStringDictionary(e.bytes, values.length);
    expect(decoded).toEqual(values);
  });

  test('single unique value', () => {
    const values = ['error', 'error', 'error', 'error'];
    const e = encodeStringDictionary(values);
    expect(decodeStringDictionary(e.bytes, values.length)).toEqual(values);
  });

  test('empty input', () => {
    const e = encodeStringDictionary([]);
    expect(e.count).toBe(0);
    expect(decodeStringDictionary(e.bytes, 0)).toEqual([]);
  });

  test('all unique values (worst-case dictionary)', () => {
    const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const e = encodeStringDictionary(values);
    expect(decodeStringDictionary(e.bytes, values.length)).toEqual(values);
  });

  test('unicode strings survive', () => {
    const values = ['hello', '世界', 'café', '🚀', 'world'];
    const e = encodeStringDictionary(values);
    expect(decodeStringDictionary(e.bytes, values.length)).toEqual(values);
  });

  test('large dictionary (1024 unique values)', () => {
    const dict: string[] = [];
    for (let i = 0; i < 1024; i++) dict.push(`val_${i}`);
    const values = [...dict, ...dict.slice(0, 100)];
    const e = encodeStringDictionary(values);
    expect(decodeStringDictionary(e.bytes, values.length)).toEqual(values);
  });
});

describe('encodeStringDictionary — compression efficacy', () => {
  test('few unique values use few bits per id', () => {
    // 2 unique values → 1 bit per id → 1024 ids = 128 bytes packed
    const values: string[] = [];
    for (let i = 0; i < 1024; i++) values.push(i % 2 === 0 ? 'prod' : 'dev');
    const e = encodeStringDictionary(values);
    // dict overhead: 4 (count) + 4+4 ("prod") + 4+3 ("dev") + 1 (bits) + 4 (idsLen) = 24
    // packed ids: 128 bytes
    expect(e.bytes.byteLength).toBe(24 + 128);
  });
});

describe('decodeStringDictionary — errors', () => {
  test('truncated header throws', () => {
    expect(() => decodeStringDictionary(new Uint8Array(2), 0)).toThrow(RangeError);
  });

  test('truncated dict entry throws', () => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setUint32(0, 1, true); // dict count 1
    new DataView(bytes.buffer).setUint32(4, 100, true); // strLen 100 but no body
    expect(() => decodeStringDictionary(bytes, 0)).toThrow(RangeError);
  });
});

describe('property: round trip with arbitrary string columns', () => {
  test('arbitrary strings round-trip', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 32 }), {
          minLength: 0,
          maxLength: 64,
        }),
        (values) => {
          const e = encodeStringDictionary(values);
          expect(decodeStringDictionary(e.bytes, values.length)).toEqual(values);
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
