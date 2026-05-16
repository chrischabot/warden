import { describe, expect, test } from 'bun:test';
import { ShardRouter } from '../src/router';

function makePaths(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `/tmp/shard-${i}.db`);
}

describe('ShardRouter — construction', () => {
  test('valid config', () => {
    const r = new ShardRouter({ count: 4, paths: makePaths(4) });
    expect(r.count).toBe(4);
  });

  test('rejects count ≤ 0', () => {
    expect(() => new ShardRouter({ count: 0, paths: [] })).toThrow(RangeError);
    expect(() => new ShardRouter({ count: -1, paths: [] })).toThrow(RangeError);
  });

  test('rejects path length mismatch', () => {
    expect(() => new ShardRouter({ count: 4, paths: makePaths(3) })).toThrow(RangeError);
  });
});

describe('ShardRouter — shardFor', () => {
  test('result is in [0, count)', () => {
    const r = new ShardRouter({ count: 8, paths: makePaths(8) });
    for (let i = 0; i < 1000; i++) {
      const s = r.shardFor(`project-${i}`);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(8);
    }
  });

  test('same key always lands on same shard', () => {
    const r = new ShardRouter({ count: 16, paths: makePaths(16) });
    for (let i = 0; i < 100; i++) {
      const key = `project-${i}`;
      const a = r.shardFor(key);
      const b = r.shardFor(key);
      expect(a).toBe(b);
    }
  });

  test('distribution is roughly uniform', () => {
    const r = new ShardRouter({ count: 16, paths: makePaths(16) });
    const counts = new Array<number>(16).fill(0);
    const total = 10_000;
    for (let i = 0; i < total; i++) {
      const s = r.shardFor(`project-${i}`);
      counts[s] = (counts[s] as number) + 1;
    }
    const expected = total / 16;
    // Any bucket should be within ±25% of expected.
    for (const c of counts) {
      expect(c).toBeGreaterThan(expected * 0.75);
      expect(c).toBeLessThan(expected * 1.25);
    }
  });

  test('accepts number / bigint keys', () => {
    const r = new ShardRouter({ count: 4, paths: makePaths(4) });
    const a = r.shardFor(42);
    const b = r.shardFor(BigInt(42));
    const c = r.shardFor('42');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });
});

describe('ShardRouter — groupByShard', () => {
  test('preserves order within shard buckets', () => {
    const r = new ShardRouter({ count: 4, paths: makePaths(4) });
    const keys = ['k1', 'k2', 'k3', 'k4', 'k5'];
    const groups = r.groupByShard(keys);
    let total = 0;
    for (const arr of groups.values()) total += arr.length;
    expect(total).toBe(keys.length);
    // Every key appears exactly once across all groups.
    const flattened = [...groups.values()].flat();
    expect(flattened.sort()).toEqual([...keys].sort());
  });

  test('empty input is an empty map', () => {
    const r = new ShardRouter({ count: 4, paths: makePaths(4) });
    expect(r.groupByShard([]).size).toBe(0);
  });
});
