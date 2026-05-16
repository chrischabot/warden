import { describe, expect, test } from 'bun:test';
import { RateLimiter } from '../src/limiter';

describe('RateLimiter — per-key isolation', () => {
  test('distinct (project, category) pairs have independent buckets', () => {
    const rl = new RateLimiter({ defaultCapacity: 3, defaultRefillPerSec: 0 });
    for (let i = 0; i < 3; i++) {
      expect(rl.check('1', 'event', 1, 0)).toBe('accepted');
    }
    expect(rl.check('1', 'event', 1, 0)).toBe('rate_limited');
    // Different project — fresh bucket.
    expect(rl.check('2', 'event', 1, 0)).toBe('accepted');
    // Different category, same project — fresh bucket.
    expect(rl.check('1', 'attachment', 1, 0)).toBe('accepted');
  });

  test('refill is per-key', () => {
    const rl = new RateLimiter({ defaultCapacity: 1, defaultRefillPerSec: 1 });
    expect(rl.check('1', 'event', 1, 0)).toBe('accepted');
    expect(rl.check('1', 'event', 1, 0)).toBe('rate_limited');
    expect(rl.check('1', 'event', 1, 1500)).toBe('accepted');
  });
});

describe('RateLimiter — rule matching', () => {
  test('exact match wins over default', () => {
    const rl = new RateLimiter({
      rules: [{ projectId: '7', dataCategory: 'event', capacity: 1, refillPerSec: 0 }],
      defaultCapacity: 100,
      defaultRefillPerSec: 0,
    });
    expect(rl.check('7', 'event', 1, 0)).toBe('accepted');
    expect(rl.check('7', 'event', 1, 0)).toBe('rate_limited');
    // Other project gets the default.
    for (let i = 0; i < 100; i++) {
      expect(rl.check('8', 'event', 1, 0)).toBe('accepted');
    }
  });

  test('wildcard project applies to any project, but specific rule wins', () => {
    const rl = new RateLimiter({
      rules: [
        { projectId: '7', dataCategory: 'event', capacity: 100, refillPerSec: 0 },
        { projectId: '*', dataCategory: 'event', capacity: 1, refillPerSec: 0 },
      ],
      defaultCapacity: 10,
      defaultRefillPerSec: 0,
    });
    // Project 7 hits the specific rule (100 cap).
    for (let i = 0; i < 100; i++) {
      expect(rl.check('7', 'event', 1, 0)).toBe('accepted');
    }
    expect(rl.check('7', 'event', 1, 0)).toBe('rate_limited');
    // Other project hits the wildcard rule (1 cap).
    expect(rl.check('8', 'event', 1, 0)).toBe('accepted');
    expect(rl.check('8', 'event', 1, 0)).toBe('rate_limited');
  });

  test('wildcard category applies to any category', () => {
    const rl = new RateLimiter({
      rules: [{ projectId: '7', dataCategory: '*', capacity: 2, refillPerSec: 0 }],
      defaultCapacity: 100,
      defaultRefillPerSec: 0,
    });
    expect(rl.check('7', 'event', 1, 0)).toBe('accepted');
    expect(rl.check('7', 'event', 1, 0)).toBe('accepted');
    expect(rl.check('7', 'event', 1, 0)).toBe('rate_limited');
    // Same project, different category — separate bucket but same rule.
    expect(rl.check('7', 'attachment', 1, 0)).toBe('accepted');
    expect(rl.check('7', 'attachment', 1, 0)).toBe('accepted');
    expect(rl.check('7', 'attachment', 1, 0)).toBe('rate_limited');
  });

  test('full wildcard rule applies to all keys', () => {
    const rl = new RateLimiter({
      rules: [{ projectId: '*', dataCategory: '*', capacity: 1, refillPerSec: 0 }],
    });
    expect(rl.check('1', 'event', 1, 0)).toBe('accepted');
    expect(rl.check('1', 'event', 1, 0)).toBe('rate_limited');
    expect(rl.check('2', 'transaction', 1, 0)).toBe('accepted');
    expect(rl.check('2', 'transaction', 1, 0)).toBe('rate_limited');
  });
});

describe('RateLimiter — diagnostics', () => {
  test('available reports current capacity without consuming', () => {
    const rl = new RateLimiter({ defaultCapacity: 5, defaultRefillPerSec: 0 });
    expect(rl.available('1', 'event', 0)).toBe(5);
    rl.check('1', 'event', 3, 0);
    expect(rl.available('1', 'event', 0)).toBe(2);
  });

  test('bucketCount grows as new keys are seen', () => {
    const rl = new RateLimiter({ defaultCapacity: 10, defaultRefillPerSec: 0 });
    expect(rl.bucketCount).toBe(0);
    rl.check('1', 'event');
    rl.check('1', 'event');
    expect(rl.bucketCount).toBe(1);
    rl.check('1', 'attachment');
    rl.check('2', 'event');
    expect(rl.bucketCount).toBe(3);
  });
});

describe('RateLimiter — burst then drain pattern', () => {
  test('20 events/sec sustained over 5 seconds is admitted at 100/sec capacity', () => {
    const rl = new RateLimiter({
      defaultCapacity: 100,
      defaultRefillPerSec: 100,
    });
    let now = 0;
    let admitted = 0;
    let dropped = 0;
    for (let i = 0; i < 100; i++) {
      // 20 events/sec ⇒ 50 ms between events.
      now += 50;
      if (rl.check('1', 'event', 1, now) === 'accepted') admitted++;
      else dropped++;
    }
    expect(admitted).toBe(100);
    expect(dropped).toBe(0);
  });

  test('200 events/sec sustained against 100/sec refill drops the excess', () => {
    const rl = new RateLimiter({
      defaultCapacity: 100,
      defaultRefillPerSec: 100,
    });
    let now = 0;
    let admitted = 0;
    for (let i = 0; i < 1000; i++) {
      // 200 events/sec ⇒ 5 ms between events.
      now += 5;
      if (rl.check('1', 'event', 1, now) === 'accepted') admitted++;
    }
    // 1000 events over 5000ms; refill produces 500; plus initial 100 capacity = 600 admitted.
    expect(admitted).toBeGreaterThanOrEqual(595);
    expect(admitted).toBeLessThanOrEqual(605);
  });
});
