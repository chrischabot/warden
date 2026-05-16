import { describe, expect, test } from 'bun:test';
import { HLL } from '../src/hll';

describe('HLL — basic behaviour', () => {
  test('empty digest estimates 0', () => {
    const h = new HLL();
    expect(h.estimate()).toBeCloseTo(0, 1);
  });

  test('all-duplicate stream estimates ~1', () => {
    const h = new HLL();
    for (let i = 0; i < 10000; i++) h.add('same');
    expect(h.estimate()).toBeGreaterThan(0.9);
    expect(h.estimate()).toBeLessThan(1.1);
  });

  test('precision out of range rejected', () => {
    expect(() => new HLL(3)).toThrow(RangeError);
    expect(() => new HLL(19)).toThrow(RangeError);
    expect(() => new HLL(2.5)).toThrow(RangeError);
  });

  test('register array sizing', () => {
    expect(new HLL(4).m).toBe(16);
    expect(new HLL(10).m).toBe(1024);
    expect(new HLL(14).m).toBe(16384);
  });
});

describe('HLL — cardinality accuracy', () => {
  test('100 unique items: within 10%', () => {
    const h = new HLL();
    for (let i = 0; i < 100; i++) h.add(`v_${i}`);
    const est = h.estimate();
    expect(est).toBeGreaterThan(90);
    expect(est).toBeLessThan(110);
  });

  test('10000 unique items: within 5%', () => {
    const h = new HLL();
    for (let i = 0; i < 10000; i++) h.add(`item_${i}`);
    const est = h.estimate();
    expect(est).toBeGreaterThan(9500);
    expect(est).toBeLessThan(10500);
  });

  test('100000 unique items: within 3%', () => {
    const h = new HLL();
    for (let i = 0; i < 100000; i++) h.add(`item_${i}`);
    const est = h.estimate();
    expect(est).toBeGreaterThan(97000);
    expect(est).toBeLessThan(103000);
  });
});

describe('HLL — merge', () => {
  test('merge is associative across distinct sets', () => {
    const a = new HLL();
    const b = new HLL();
    for (let i = 0; i < 5000; i++) a.add(`a_${i}`);
    for (let i = 0; i < 5000; i++) b.add(`b_${i}`);
    a.merge(b);
    const est = a.estimate();
    expect(est).toBeGreaterThan(9500);
    expect(est).toBeLessThan(10500);
  });

  test('merge of overlapping sets reflects union cardinality', () => {
    const a = new HLL();
    const b = new HLL();
    for (let i = 0; i < 5000; i++) a.add(`shared_${i}`);
    for (let i = 0; i < 5000; i++) b.add(`shared_${i}`);
    a.merge(b);
    const est = a.estimate();
    expect(est).toBeGreaterThan(4700);
    expect(est).toBeLessThan(5300);
  });

  test('rejects mismatched precision', () => {
    expect(() => new HLL(10).merge(new HLL(14))).toThrow();
  });
});

describe('HLL — serialize/deserialize', () => {
  test('round trips', () => {
    const h = new HLL(12);
    for (let i = 0; i < 1000; i++) h.add(`k_${i}`);
    const bytes = h.serialize();
    const decoded = HLL.deserialize(bytes);
    expect(decoded.precision).toBe(12);
    expect(decoded.m).toBe(4096);
    expect(decoded.registers).toEqual(h.registers);
    expect(decoded.estimate()).toBeCloseTo(h.estimate(), 5);
  });

  test('rejects truncated buffer', () => {
    expect(() => HLL.deserialize(new Uint8Array(0))).toThrow(RangeError);
    expect(() => HLL.deserialize(new Uint8Array([14, 0, 0]))).toThrow(RangeError);
  });
});
