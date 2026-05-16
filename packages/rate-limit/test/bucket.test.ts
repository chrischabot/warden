import { describe, expect, test } from 'bun:test';
import { LeakyBucket } from '../src/bucket';

describe('LeakyBucket — basic acquire', () => {
  test('starts full and drains', () => {
    const b = new LeakyBucket({ capacity: 5, refillPerSec: 0, initialNowMs: 1000 });
    for (let i = 0; i < 5; i++) {
      expect(b.tryAcquire(1, 1000)).toBe(true);
    }
    expect(b.tryAcquire(1, 1000)).toBe(false);
  });

  test('available decrements correspondingly', () => {
    const b = new LeakyBucket({ capacity: 10, refillPerSec: 0, initialNowMs: 0 });
    expect(b.available(0)).toBe(10);
    b.tryAcquire(3, 0);
    expect(b.available(0)).toBe(7);
  });

  test('tryAcquire(0) always succeeds without state change', () => {
    const b = new LeakyBucket({ capacity: 1, refillPerSec: 0, initialNowMs: 0 });
    expect(b.tryAcquire(0, 0)).toBe(true);
    expect(b.available(0)).toBe(1);
  });
});

describe('LeakyBucket — refill', () => {
  test('refills over time at refillPerSec', () => {
    const b = new LeakyBucket({ capacity: 10, refillPerSec: 1, initialTokens: 0, initialNowMs: 0 });
    expect(b.tryAcquire(1, 0)).toBe(false);
    expect(b.available(1000)).toBeCloseTo(1, 5);
    expect(b.tryAcquire(1, 1000)).toBe(true);
    expect(b.available(1000)).toBeCloseTo(0, 5);
    expect(b.available(11_000)).toBeCloseTo(10, 5);
    expect(b.available(20_000)).toBe(10); // capped at capacity
  });

  test('clock not going backwards yields no refill', () => {
    const b = new LeakyBucket({
      capacity: 5,
      refillPerSec: 1,
      initialTokens: 0,
      initialNowMs: 5000,
    });
    expect(b.available(4000)).toBe(0);
    expect(b.tryAcquire(1, 4000)).toBe(false);
  });

  test('refill caps at capacity even with huge gap', () => {
    const b = new LeakyBucket({
      capacity: 10,
      refillPerSec: 1000,
      initialTokens: 0,
      initialNowMs: 0,
    });
    expect(b.available(60_000)).toBe(10);
  });
});

describe('LeakyBucket — validation', () => {
  test('rejects bad config', () => {
    expect(() => new LeakyBucket({ capacity: 0, refillPerSec: 1 })).toThrow(RangeError);
    expect(() => new LeakyBucket({ capacity: -1, refillPerSec: 1 })).toThrow(RangeError);
    expect(() => new LeakyBucket({ capacity: 1, refillPerSec: -1 })).toThrow(RangeError);
    expect(() => new LeakyBucket({ capacity: 5, refillPerSec: 1, initialTokens: 6 })).toThrow(
      RangeError,
    );
    expect(() => new LeakyBucket({ capacity: 5, refillPerSec: 1, initialTokens: -1 })).toThrow(
      RangeError,
    );
  });

  test('refillPerSec=0 is allowed (static bucket)', () => {
    const b = new LeakyBucket({ capacity: 3, refillPerSec: 0, initialNowMs: 0 });
    for (let i = 0; i < 3; i++) expect(b.tryAcquire(1, 60_000)).toBe(true);
    expect(b.tryAcquire(1, 60_000)).toBe(false);
  });

  test('rejects negative acquire amount', () => {
    const b = new LeakyBucket({ capacity: 5, refillPerSec: 1 });
    expect(() => b.tryAcquire(-1)).toThrow(RangeError);
  });
});

describe('LeakyBucket — invariant: never above capacity', () => {
  test('many fast refills stay capped', () => {
    const b = new LeakyBucket({ capacity: 5, refillPerSec: 10_000, initialNowMs: 0 });
    expect(b.available(1_000_000)).toBe(5);
    b.tryAcquire(2, 1_000_000);
    expect(b.available(1_000_000)).toBeCloseTo(3, 5);
    expect(b.available(2_000_000)).toBe(5);
  });
});
