/**
 * Per-(project, data_category) leaky-bucket rate limiter.
 *
 * Configure with a list of rules and a default. Each rule matches
 * a (project, category) pair (either may be `*` as a wildcard).
 * The first matching rule wins; if none matches, the default rule
 * applies. Buckets are allocated lazily and held in a nested Map
 * keyed by `projectId → dataCategory → LeakyBucket` so the hot
 * `check()` path makes two cheap Map lookups instead of allocating
 * a composite key string per call.
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

interface ResolvedRule {
  readonly capacity: number;
  readonly refillPerSec: number;
}

export class RateLimiter {
  private readonly rules: readonly RateLimitRule[];
  private readonly defaultRule: ResolvedRule;
  /**
   * Nested map: projectId → (dataCategory → bucket). Two map lookups
   * per `check()`; no per-call key string allocation.
   */
  private readonly byProject = new Map<string, Map<string, LeakyBucket>>();
  /** Per-(projectId, dataCategory) resolved-rule cache. */
  private readonly ruleCache = new Map<string, Map<string, ResolvedRule>>();
  private bucketCount_ = 0;

  constructor(config: RateLimiterConfig = {}) {
    this.rules = config.rules ? [...config.rules] : [];
    this.defaultRule = Object.freeze({
      capacity: config.defaultCapacity ?? 100,
      refillPerSec: config.defaultRefillPerSec ?? 10,
    });
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
    return this.bucketCount_;
  }

  private bucketFor(projectId: string, dataCategory: string, nowMs: number): LeakyBucket {
    let inner = this.byProject.get(projectId);
    if (!inner) {
      inner = new Map();
      this.byProject.set(projectId, inner);
    }
    let bucket = inner.get(dataCategory);
    if (!bucket) {
      const rule = this.matchRule(projectId, dataCategory);
      bucket = new LeakyBucket({
        capacity: rule.capacity,
        refillPerSec: rule.refillPerSec,
        initialNowMs: nowMs,
      });
      inner.set(dataCategory, bucket);
      this.bucketCount_++;
    }
    return bucket;
  }

  private matchRule(projectId: string, dataCategory: string): ResolvedRule {
    let inner = this.ruleCache.get(projectId);
    if (!inner) {
      inner = new Map();
      this.ruleCache.set(projectId, inner);
    }
    const cached = inner.get(dataCategory);
    if (cached) return cached;

    let resolved: ResolvedRule = this.defaultRule;
    for (const r of this.rules) {
      if (
        (r.projectId === '*' || r.projectId === projectId) &&
        (r.dataCategory === '*' || r.dataCategory === dataCategory)
      ) {
        resolved = { capacity: r.capacity, refillPerSec: r.refillPerSec };
        break;
      }
    }
    inner.set(dataCategory, resolved);
    return resolved;
  }
}