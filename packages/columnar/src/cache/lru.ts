/**
 * Generic LRU cache.
 *
 * Backed by `Map`, which guarantees iteration in insertion order
 * — we exploit that to maintain MRU/LRU positions by re-inserting
 * on every `get`.
 *
 * Options:
 *   - `maxEntries` — cap on the number of cached entries
 *   - `maxBytes`   — cap on the summed weights of cached entries
 *   - `weight(v)`  — per-value weight in bytes; default 1
 *   - `ttlMs`      — entries expire on first `get` after this many ms
 *
 * Eviction runs on `set` until both caps are satisfied.
 */

export interface LRUOptions<V> {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly weight?: (value: V) => number;
  readonly ttlMs?: number;
}

interface Entry<V> {
  value: V;
  weight: number;
  expiresAt: number | undefined;
}

export class LRUCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly opts: LRUOptions<V>;
  private bytesUsed = 0;

  constructor(opts: LRUOptions<V> = {}) {
    if (opts.maxEntries !== undefined && opts.maxEntries < 0) {
      throw new RangeError('LRUCache: maxEntries must be >= 0');
    }
    if (opts.maxBytes !== undefined && opts.maxBytes < 0) {
      throw new RangeError('LRUCache: maxBytes must be >= 0');
    }
    if (opts.ttlMs !== undefined && opts.ttlMs <= 0) {
      throw new RangeError('LRUCache: ttlMs must be positive');
    }
    this.opts = opts;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this.bytesUsed -= entry.weight;
      return undefined;
    }
    // Refresh MRU position.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const weight = this.opts.weight ? this.opts.weight(value) : 1;
    const existing = this.map.get(key);
    if (existing) {
      this.bytesUsed -= existing.weight;
      this.map.delete(key);
    }
    const expiresAt = this.opts.ttlMs !== undefined ? Date.now() + this.opts.ttlMs : undefined;
    this.map.set(key, { value, weight, expiresAt });
    this.bytesUsed += weight;
    this.evict();
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this.bytesUsed -= entry.weight;
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.bytesUsed -= entry.weight;
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.bytesUsed = 0;
  }

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.bytesUsed;
  }

  /** Force a sweep of expired entries. Useful in tests. */
  sweep(): void {
    if (this.opts.ttlMs === undefined) return;
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        this.bytesUsed -= entry.weight;
        this.map.delete(key);
      }
    }
  }

  private evict(): void {
    while (
      (this.opts.maxEntries !== undefined && this.map.size > this.opts.maxEntries) ||
      (this.opts.maxBytes !== undefined && this.bytesUsed > this.opts.maxBytes)
    ) {
      const iter = this.map.keys();
      const result = iter.next();
      if (result.done) break;
      const oldestKey = result.value;
      const entry = this.map.get(oldestKey);
      if (entry) this.bytesUsed -= entry.weight;
      this.map.delete(oldestKey);
    }
  }
}
