import { describe, expect, test } from 'bun:test';
import { CountMinSketch } from '../src/cms';

describe('CountMinSketch — basic behaviour', () => {
  test('empty sketch returns 0 for any query', () => {
    const c = new CountMinSketch();
    expect(c.query('anything')).toBe(0);
  });

  test('query is always ≥ true count', () => {
    const c = new CountMinSketch();
    const counts = new Map<string, number>();
    for (let i = 0; i < 5000; i++) {
      const key = `item_${i % 100}`;
      c.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, trueCount] of counts) {
      expect(c.query(key)).toBeGreaterThanOrEqual(trueCount);
    }
  });

  test('heavy hitter accuracy', () => {
    const c = new CountMinSketch();
    for (let i = 0; i < 1000; i++) c.add('hot');
    for (let i = 0; i < 10000; i++) c.add(`cold_${i}`);
    const estimate = c.query('hot');
    expect(estimate).toBeGreaterThanOrEqual(1000);
    // Conservative update bounds error tightly for heavy hitters.
    expect(estimate).toBeLessThan(1100);
  });

  test('rejects bad shape', () => {
    expect(() => new CountMinSketch(0, 5)).toThrow(RangeError);
    expect(() => new CountMinSketch(2048, 0)).toThrow(RangeError);
  });
});

describe('CountMinSketch — merge', () => {
  test('sums per-cell counts across compatible sketches', () => {
    const a = new CountMinSketch();
    const b = new CountMinSketch();
    for (let i = 0; i < 500; i++) a.add('shared');
    for (let i = 0; i < 500; i++) b.add('shared');
    a.merge(b);
    expect(a.query('shared')).toBeGreaterThanOrEqual(1000);
  });

  test('rejects shape mismatch', () => {
    const a = new CountMinSketch(2048, 5);
    const b = new CountMinSketch(1024, 5);
    expect(() => a.merge(b)).toThrow();
  });
});

describe('CountMinSketch — serialize/deserialize', () => {
  test('round trips counts', () => {
    const c = new CountMinSketch(256, 4);
    for (let i = 0; i < 200; i++) c.add(`x_${i}`);
    c.add('hot', 100);
    const bytes = c.serialize();
    const decoded = CountMinSketch.deserialize(bytes);
    expect(decoded.width).toBe(256);
    expect(decoded.depth).toBe(4);
    expect(decoded.query('hot')).toBe(c.query('hot'));
    for (let i = 0; i < 200; i++) {
      expect(decoded.query(`x_${i}`)).toBe(c.query(`x_${i}`));
    }
  });
});
