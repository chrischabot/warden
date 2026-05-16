import { describe, expect, test } from 'bun:test';
import { hash32, hash64 } from '../src/hash';

describe('hash64', () => {
  test('deterministic for the same input and seed', () => {
    const a = hash64('hello', 0);
    const b = hash64('hello', 0);
    expect(a).toBe(b);
  });

  test('different seeds produce different hashes', () => {
    const a = hash64('hello', 0);
    const b = hash64('hello', 1);
    expect(a).not.toBe(b);
  });

  test('accepts Uint8Array input', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(hash64(bytes, 0)).toBe(hash64('hello', 0));
  });
});

describe('hash32', () => {
  test('low 32 bits of hash64', () => {
    const h64 = hash64('abc', 42);
    const h32 = hash32('abc', 42);
    expect(h32).toBe(Number(h64 & 0xffffffffn) >>> 0);
  });

  test('returns unsigned 32-bit value', () => {
    for (const s of ['a', 'bb', 'ccc', '']) {
      const h = hash32(s, 0);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
