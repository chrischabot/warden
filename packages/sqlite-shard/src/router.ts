/**
 * Shard router.
 *
 * `shardFor(key)` returns an integer in `[0, count)` derived from a
 * uniform hash of `key`. We use Bun.hash (wyhash) which is fast
 * and well-distributed for the project-id / org-id key space.
 *
 * The router doesn't open or close any databases; it's a pure
 * function over the configured shard count, suitable for sharing
 * across workers.
 */

import type { ShardConfig } from './types';

export class ShardRouter {
  readonly count: number;

  constructor(config: ShardConfig) {
    if (!Number.isInteger(config.count) || config.count <= 0) {
      throw new RangeError(`ShardRouter: count must be a positive integer, got ${config.count}`);
    }
    if (config.paths.length !== config.count) {
      throw new RangeError(
        `ShardRouter: paths.length (${config.paths.length}) must equal count (${config.count})`,
      );
    }
    this.count = config.count;
  }

  shardFor(key: string | number | bigint): number {
    let s: string;
    if (typeof key === 'string') {
      s = key;
    } else {
      s = String(key);
    }
    const h = (Bun.hash as (data: string) => bigint)(s);
    const unsigned = BigInt.asUintN(64, h);
    const mod = Number(unsigned % BigInt(this.count));
    return mod;
  }

  /**
   * For an ordered list of keys, returns a Map<shardIndex, key[]>
   * preserving input order. Useful for batch fan-out.
   */
  groupByShard<K extends string | number>(keys: readonly K[]): Map<number, K[]> {
    const out = new Map<number, K[]>();
    for (const k of keys) {
      const idx = this.shardFor(k);
      const arr = out.get(idx) ?? [];
      arr.push(k);
      out.set(idx, arr);
    }
    return out;
  }
}
