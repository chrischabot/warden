/**
 * Per-(project, data_category) leaky-bucket rate limiter.
 *
 * Configure with a list of rules and a default. Each rule matches
 * a (project, category) pair (either may be `*` as a wildcard).
 * The first matching rule wins; if none matches, the default rule
 * applies. Buckets are allocated lazily and held in an in-process
 * Map keyed by `${projectId}|${dataCategory}`.
 *
 * Spec §3.1 specifies Redis-backed shared state for cross-process
 * coordination; this implementation provides only the in-process
 * state. The orchestrator wires a Redis mirror in a later commit
 * (the Redis client + pub/sub piece is a thin wrapper around this
 * primitive — buckets and decisions stay here).
 */

import { LeakyBucket } from './bucket';

export interface RateLimitRule {
  /** Project id, or `*` to match all projects. */
  readonly projectId: string;
  /** Data category (event, transaction, attachment, …), or `*` to match all. */
  readonly dataCategory: string;
  readonly capacity: number;
  readonly refillPerSec: number;
}

export interface RateLimiterConfig {
  /** Ordered list of overrides; first match wins. */
  readonly rules?: readonly RateLimitRule[];
  /** Default capacity if no rule matches. Default 100. */
  readonly defaultCapacity?: number;
  /** Default refill rate if no rule matches. Default 10/sec. */
  readonly defaultRefillPerSec?: number;
}

export type LimitDecision = 'accepted' | 'rate_limited';

export class RateLimiter {
  private readonly rules: readonly RateLimitRule[];
  private readonly defaultCapacity: number;
  private readonly defaultRefillPerSec: number;
  private readonly buckets = new Map<string, LeakyBucket>();

  constructor(config: RateLimiterConfig = {}) {
    this.rules = config.rules ? [...config.rules] : [];
    this.defaultCapacity = config.defaultCapacity ?? 100;
    this.defaultRefillPerSec = config.defaultRefillPerSec ?? 10;
  }

  /** Try to admit `tokens` items. Returns the decision. */
  check(
    projectId: string,
    dataCategory: string,
    tokens: number = 1,
    now: number = Date.now(),
  ): LimitDecision {
    const bucket = this.bucketFor(projectId, dataCategory, now);
    return bucket.tryAcquire(tokens, now) ? 'accepted' : 'rate_limited';
  }

  /**
   * Current available tokens for a key, computed without consuming.
   * Useful for diagnostics and the relay's 429 Retry-After header.
   */
  available(projectId: string, dataCategory: string, now: number = Date.now()): number {
    const bucket = this.bucketFor(projectId, dataCategory, now);
    return bucket.available(now);
  }

  /** Number of distinct buckets currently held. */
  get bucketCount(): number {
    return this.buckets.size;
  }

  private bucketFor(projectId: string, dataCategory: string, nowMs: number): LeakyBucket {
    const key = `${projectId}|${dataCategory}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      const rule = this.matchRule(projectId, dataCategory);
      bucket = new LeakyBucket({
        capacity: rule.capacity,
        refillPerSec: rule.refillPerSec,
        initialNowMs: nowMs,
      });
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private matchRule(
    projectId: string,
    dataCategory: string,
  ): {
    capacity: number;
    refillPerSec: number;
  } {
    for (const r of this.rules) {
      if (
        (r.projectId === '*' || r.projectId === projectId) &&
        (r.dataCategory === '*' || r.dataCategory === dataCategory)
      ) {
        return { capacity: r.capacity, refillPerSec: r.refillPerSec };
      }
    }
    return {
      capacity: this.defaultCapacity,
      refillPerSec: this.defaultRefillPerSec,
    };
  }
}
