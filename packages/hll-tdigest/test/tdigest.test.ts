import { describe, expect, test } from 'bun:test';
import { TDigest } from '../src/tdigest';

describe('TDigest — edge cases', () => {
  test('empty digest returns NaN for any quantile', () => {
    const t = new TDigest();
    expect(Number.isNaN(t.quantile(0.5))).toBe(true);
  });

  test('single sample returns its value for any q', () => {
    const t = new TDigest();
    t.add(42);
    expect(t.quantile(0)).toBe(42);
    expect(t.quantile(0.5)).toBe(42);
    expect(t.quantile(1)).toBe(42);
  });

  test('rejects out-of-range q', () => {
    const t = new TDigest();
    expect(() => t.quantile(-0.1)).toThrow(RangeError);
    expect(() => t.quantile(1.1)).toThrow(RangeError);
  });

  test('rejects non-finite values and non-positive weights', () => {
    const t = new TDigest();
    expect(() => t.add(Number.NaN)).toThrow(RangeError);
    expect(() => t.add(0, 0)).toThrow(RangeError);
    expect(() => t.add(0, -1)).toThrow(RangeError);
  });

  test('rejects too-small delta', () => {
    expect(() => new TDigest(5)).toThrow(RangeError);
  });
});

describe('TDigest — quantile accuracy', () => {
  test('uniform distribution: median within 3% of expected', () => {
    const t = new TDigest();
    for (let i = 1; i <= 1000; i++) t.add(i);
    const median = t.quantile(0.5);
    expect(median).toBeGreaterThan(485);
    expect(median).toBeLessThan(515);
  });

  test('uniform distribution: p99 within 2%', () => {
    const t = new TDigest();
    for (let i = 1; i <= 10000; i++) t.add(i);
    const p99 = t.quantile(0.99);
    expect(p99).toBeGreaterThan(9700);
    expect(p99).toBeLessThan(10000);
  });

  test('uniform distribution: extremes recover the endpoints', () => {
    const t = new TDigest();
    for (let i = 1; i <= 1000; i++) t.add(i);
    expect(t.quantile(0)).toBe(1);
    expect(t.quantile(1)).toBe(1000);
  });

  test('constant samples: all quantiles return the constant', () => {
    const t = new TDigest();
    for (let i = 0; i < 1000; i++) t.add(7);
    expect(t.quantile(0)).toBe(7);
    expect(t.quantile(0.5)).toBe(7);
    expect(t.quantile(0.99)).toBe(7);
  });

  test('p50 of shuffled inputs matches sorted-input p50', () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9];
    const a = new TDigest();
    const b = new TDigest();
    for (const v of values) a.add(v);
    for (const v of [...values].sort((x, y) => x - y)) b.add(v);
    expect(a.quantile(0.5)).toBeCloseTo(b.quantile(0.5), 3);
  });
});

describe('TDigest — merge', () => {
  test('merging two halves matches the full-sample digest', () => {
    const full = new TDigest();
    const a = new TDigest();
    const b = new TDigest();
    for (let i = 1; i <= 10000; i++) {
      full.add(i);
      if (i <= 5000) a.add(i);
      else b.add(i);
    }
    a.merge(b);
    expect(a.totalCount).toBe(10000);
    expect(a.quantile(0.5)).toBeCloseTo(full.quantile(0.5), -1);
    expect(a.quantile(0.95)).toBeCloseTo(full.quantile(0.95), -1);
  });
});

describe('TDigest — serialize/deserialize', () => {
  test('round trips quantile estimates', () => {
    const t = new TDigest();
    for (let i = 1; i <= 1000; i++) t.add(i);
    const bytes = t.serialize();
    const decoded = TDigest.deserialize(bytes);
    expect(decoded.delta).toBe(t.delta);
    expect(decoded.totalCount).toBe(t.totalCount);
    expect(decoded.quantile(0.5)).toBeCloseTo(t.quantile(0.5), 5);
    expect(decoded.quantile(0.99)).toBeCloseTo(t.quantile(0.99), 5);
  });

  test('rejects truncated buffer', () => {
    expect(() => TDigest.deserialize(new Uint8Array(0))).toThrow(RangeError);
    expect(() => TDigest.deserialize(new Uint8Array(20))).toThrow(RangeError);
  });
});
