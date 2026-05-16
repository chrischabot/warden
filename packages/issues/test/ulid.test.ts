import { describe, expect, test } from 'bun:test';
import { MonotonicUlid, ulid } from '../src/ulid';

describe('ulid', () => {
  test('produces 26-char Crockford base32', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)).toBe(true);
  });

  test('100 IDs are unique', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(ulid());
    expect(set.size).toBe(100);
  });

  test('time prefix sorts lexicographically when given monotone times', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });

  test('rejects negative or non-finite time', () => {
    expect(() => ulid(-1)).toThrow(RangeError);
    expect(() => ulid(NaN)).toThrow(RangeError);
  });
});

describe('MonotonicUlid', () => {
  test('within the same ms, successive IDs strictly increase', () => {
    const gen = new MonotonicUlid();
    const a = gen.next(1_700_000_000_000);
    const b = gen.next(1_700_000_000_000);
    const c = gen.next(1_700_000_000_000);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });
});
