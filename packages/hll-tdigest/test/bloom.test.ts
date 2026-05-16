import { describe, expect, test } from 'bun:test';
import { BloomFilter } from '../src/bloom';

describe('BloomFilter — zero false negatives', () => {
  test('any added item is reported present', () => {
    const bf = new BloomFilter(10_000, 7);
    const items: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const v = `id_${i}`;
      items.push(v);
      bf.add(v);
    }
    for (const v of items) {
      expect(bf.has(v)).toBe(true);
    }
  });
});

describe('BloomFilter — false-positive rate', () => {
  test('withFpr(n, 0.01) keeps FPR within ~2x of target', () => {
    const n = 1000;
    const target = 0.01;
    const bf = BloomFilter.withFpr(n, target);
    for (let i = 0; i < n; i++) bf.add(`in_${i}`);
    let fp = 0;
    const probes = 10_000;
    for (let i = 0; i < probes; i++) {
      if (bf.has(`out_${i}`)) fp++;
    }
    const fpr = fp / probes;
    // Slack factor 2x to absorb hash variance on a finite probe set.
    expect(fpr).toBeLessThan(target * 2);
  });

  test("withFpr produces the spec's 10 bits/key, 7 hashes for ~1% FPR", () => {
    const bf = BloomFilter.withFpr(1000, 0.01);
    expect(bf.k).toBe(7);
    // m ≈ -n*ln(fpr)/(ln2^2) ≈ 9585.06 → 9586.
    expect(bf.m).toBeGreaterThan(9500);
    expect(bf.m).toBeLessThan(9700);
  });
});

describe('BloomFilter — invalid args', () => {
  test('rejects bad m or k', () => {
    expect(() => new BloomFilter(0, 1)).toThrow(RangeError);
    expect(() => new BloomFilter(10, 0)).toThrow(RangeError);
    expect(() => new BloomFilter(10, 33)).toThrow(RangeError);
  });

  test('rejects bad withFpr args', () => {
    expect(() => BloomFilter.withFpr(0, 0.1)).toThrow(RangeError);
    expect(() => BloomFilter.withFpr(100, 0)).toThrow(RangeError);
    expect(() => BloomFilter.withFpr(100, 1)).toThrow(RangeError);
  });
});

describe('BloomFilter — merge', () => {
  test('union of two filters preserves zero-false-negative property', () => {
    const a = new BloomFilter(10_000, 7);
    const b = new BloomFilter(10_000, 7);
    for (let i = 0; i < 500; i++) a.add(`a_${i}`);
    for (let i = 0; i < 500; i++) b.add(`b_${i}`);
    a.merge(b);
    for (let i = 0; i < 500; i++) {
      expect(a.has(`a_${i}`)).toBe(true);
      expect(a.has(`b_${i}`)).toBe(true);
    }
  });

  test('rejects shape mismatch', () => {
    const a = new BloomFilter(1000, 7);
    const b = new BloomFilter(1000, 5);
    expect(() => a.merge(b)).toThrow();
  });
});

describe('BloomFilter — serialize/deserialize', () => {
  test('round trips', () => {
    const bf = BloomFilter.withFpr(500, 0.01);
    for (let i = 0; i < 500; i++) bf.add(`x_${i}`);
    const bytes = bf.serialize();
    const decoded = BloomFilter.deserialize(bytes);
    expect(decoded.m).toBe(bf.m);
    expect(decoded.k).toBe(bf.k);
    expect(decoded.approximateCount).toBe(500);
    for (let i = 0; i < 500; i++) {
      expect(decoded.has(`x_${i}`)).toBe(true);
    }
  });

  test('rejects truncated buffer', () => {
    expect(() => BloomFilter.deserialize(new Uint8Array(0))).toThrow(RangeError);
    expect(() => BloomFilter.deserialize(new Uint8Array(10))).toThrow(RangeError);
  });
});
