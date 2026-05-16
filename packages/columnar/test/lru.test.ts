import { describe, expect, test } from 'bun:test';
import { LRUCache } from '../src/cache/lru';

describe('LRUCache — basic ops', () => {
  test('set/get/has/delete', () => {
    const c = new LRUCache<string, number>();
    expect(c.get('a')).toBeUndefined();
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBe(2);
    expect(c.has('a')).toBe(true);
    expect(c.has('z')).toBe(false);
    expect(c.delete('a')).toBe(true);
    expect(c.delete('a')).toBe(false);
    expect(c.size).toBe(1);
  });

  test('clear', () => {
    const c = new LRUCache<string, number>();
    c.set('a', 1);
    c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
  });
});

describe('LRUCache — entry eviction', () => {
  test('evicts oldest entry when over maxEntries', () => {
    const c = new LRUCache<string, number>({ maxEntries: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(true);
  });

  test('get refreshes position (a stays after c is set)', () => {
    const c = new LRUCache<string, number>({ maxEntries: 2 });
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // a becomes MRU
    c.set('c', 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
  });
});

describe('LRUCache — byte eviction', () => {
  test('evicts oldest when over maxBytes', () => {
    const c = new LRUCache<string, Uint8Array>({
      maxBytes: 100,
      weight: (v) => v.byteLength,
    });
    c.set('a', new Uint8Array(40));
    c.set('b', new Uint8Array(40));
    expect(c.bytes).toBe(80);
    c.set('c', new Uint8Array(40)); // total would be 120, evict 'a' (40 → 80)
    expect(c.has('a')).toBe(false);
    expect(c.bytes).toBe(80);
  });

  test('value larger than the cap evicts everything', () => {
    const c = new LRUCache<string, Uint8Array>({
      maxBytes: 50,
      weight: (v) => v.byteLength,
    });
    c.set('a', new Uint8Array(40));
    c.set('huge', new Uint8Array(200));
    // The single huge item exceeds cap; the cache empties trying to fit it.
    expect(c.has('huge')).toBe(false);
    expect(c.bytes).toBe(0);
  });
});

describe('LRUCache — TTL', () => {
  test('expired entries are dropped on get', async () => {
    const c = new LRUCache<string, number>({ ttlMs: 20 });
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    await new Promise((r) => setTimeout(r, 35));
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(0);
  });

  test('has() honours TTL', async () => {
    const c = new LRUCache<string, number>({ ttlMs: 20 });
    c.set('a', 1);
    expect(c.has('a')).toBe(true);
    await new Promise((r) => setTimeout(r, 35));
    expect(c.has('a')).toBe(false);
  });

  test('sweep() proactively removes expired entries', async () => {
    const c = new LRUCache<string, number>({ ttlMs: 10 });
    c.set('a', 1);
    c.set('b', 2);
    await new Promise((r) => setTimeout(r, 30));
    c.sweep();
    expect(c.size).toBe(0);
  });
});

describe('LRUCache — re-set on existing key', () => {
  test('updates weight, refreshes position', () => {
    const c = new LRUCache<string, Uint8Array>({
      maxBytes: 100,
      weight: (v) => v.byteLength,
    });
    c.set('a', new Uint8Array(30));
    c.set('b', new Uint8Array(30));
    expect(c.bytes).toBe(60);
    c.set('a', new Uint8Array(70));
    // Total before evict = 30 + 70 = 100, fits. Now a is MRU.
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(true);
    expect(c.bytes).toBe(100);
  });
});

describe('LRUCache — validation', () => {
  test('rejects negative maxEntries/maxBytes and non-positive ttlMs', () => {
    expect(() => new LRUCache({ maxEntries: -1 })).toThrow(RangeError);
    expect(() => new LRUCache({ maxBytes: -1 })).toThrow(RangeError);
    expect(() => new LRUCache({ ttlMs: 0 })).toThrow(RangeError);
    expect(() => new LRUCache({ ttlMs: -100 })).toThrow(RangeError);
  });
});
