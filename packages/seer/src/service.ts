/**
 * Seer orchestration service.
 *
 * Wraps a `SeerProvider` with:
 *
 *   - Per-request caching keyed by a stable hash of the request,
 *     so the same group + event doesn't re-bill the provider.
 *   - A simple TTL eviction policy (default 1 hour).
 *
 * Production wiring layers a feature-flag gate (per-org Seer
 * enablement, opt-in for AI assistance) on top of this service.
 */

import type {
  FixRequest,
  FixResponse,
  RootCauseRequest,
  RootCauseResponse,
  SeerProvider,
  SummaryRequest,
  SummaryResponse,
} from './types';

export interface SeerServiceOptions {
  /** Per-result cache TTL in ms. Default 1 hour. */
  readonly cacheTtlMs?: number;
  /** Maximum cache entries before LRU-evicting. Default 1024. */
  readonly cacheCapacity?: number;
  /** `Date.now`-equivalent for tests. */
  readonly now?: () => number;
}

interface Entry<T> {
  readonly value: T;
  readonly storedAt: number;
}

export class SeerService {
  private readonly cacheTtlMs: number;
  private readonly cacheCapacity: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, Entry<unknown>>();
  /**
   * Per-key in-flight call counter — diagnostic so callers can spot
   * whether the cache is doing its job.
   */
  private misses = 0;
  private hits = 0;

  constructor(
    public readonly provider: SeerProvider,
    options: SeerServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60 * 60_000;
    this.cacheCapacity = options.cacheCapacity ?? 1024;
    this.now = options.now ?? (() => Date.now());
  }

  async analyseRootCause(request: RootCauseRequest): Promise<RootCauseResponse> {
    const key = `${this.provider.name}:rc:${rcKey(request)}`;
    const hit = this.lookup<RootCauseResponse>(key);
    if (hit) return hit;
    const value = await this.provider.analyseRootCause(request);
    this.store(key, value);
    return value;
  }

  async suggestFix(request: FixRequest): Promise<FixResponse> {
    const key = `${this.provider.name}:fix:${fixKey(request)}`;
    const hit = this.lookup<FixResponse>(key);
    if (hit) return hit;
    const value = await this.provider.suggestFix(request);
    this.store(key, value);
    return value;
  }

  async summariseIssue(request: SummaryRequest): Promise<SummaryResponse> {
    const key = `${this.provider.name}:sum:${rcKey({ ...request, projectId: '' } as RootCauseRequest)}`;
    const hit = this.lookup<SummaryResponse>(key);
    if (hit) return hit;
    const value = await this.provider.summariseIssue(request);
    this.store(key, value);
    return value;
  }

  stats(): { readonly hits: number; readonly misses: number; readonly size: number } {
    return Object.freeze({ hits: this.hits, misses: this.misses, size: this.cache.size });
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  private lookup<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (this.now() - entry.storedAt > this.cacheTtlMs) {
      this.cache.delete(key);
      this.misses += 1;
      return undefined;
    }
    // LRU touch.
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits += 1;
    return entry.value as T;
  }

  private store<T>(key: string, value: T): void {
    if (this.cache.size >= this.cacheCapacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, storedAt: this.now() });
  }
}

function rcKey(request: RootCauseRequest): string {
  // Stable signature: group + headline exceptions only (timestamps
  // and tag-noise excluded so we cache across re-runs).
  const types = request.event.exceptions.map((e) => `${e.type}::${e.value}`).join('|');
  return `${request.projectId}::${request.groupHash}::${types}`;
}

function fixKey(request: FixRequest): string {
  const paths = request.sources
    .map((s) => s.path)
    .sort()
    .join(',');
  return `${request.cause.summary}::${paths}`;
}
