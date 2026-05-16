/**
 * Leaky bucket rate limiter primitive.
 *
 * Holds up to `capacity` tokens. Tokens refill at a continuous rate
 * of `refillPerSec`. `tryAcquire(n)` consumes `n` tokens if at
 * least `n` are currently available, returning true; otherwise
 * returns false without consuming.
 *
 * Time is injected via the `now` argument (Unix ms) so tests can
 * advance a deterministic clock instead of relying on wall-clock
 * sleeps.
 */

export interface LeakyBucketConfig {
  /** Max tokens the bucket can hold (burst ceiling). */
  readonly capacity: number;
  /** Continuous token refill rate, tokens per second. */
  readonly refillPerSec: number;
  /** Starting token level. Default = capacity (full bucket). */
  readonly initialTokens?: number;
  /** Initial timestamp. Default = Date.now() at construction. */
  readonly initialNowMs?: number;
}

export class LeakyBucket {
  readonly capacity: number;
  readonly refillPerSec: number;
  private tokens: number;
  private lastNowMs: number;

  constructor(config: LeakyBucketConfig) {
    if (!Number.isFinite(config.capacity) || config.capacity <= 0) {
      throw new RangeError(`LeakyBucket: capacity must be positive, got ${config.capacity}`);
    }
    if (!Number.isFinite(config.refillPerSec) || config.refillPerSec < 0) {
      throw new RangeError(`LeakyBucket: refillPerSec must be >= 0, got ${config.refillPerSec}`);
    }
    this.capacity = config.capacity;
    this.refillPerSec = config.refillPerSec;
    this.tokens = config.initialTokens ?? config.capacity;
    if (this.tokens < 0 || this.tokens > this.capacity) {
      throw new RangeError(
        `LeakyBucket: initialTokens must be in [0, capacity], got ${this.tokens}`,
      );
    }
    this.lastNowMs = config.initialNowMs ?? Date.now();
  }

  /** Available tokens at `now`, computed without modifying state. */
  available(now: number = Date.now()): number {
    return Math.min(this.capacity, this.tokens + this.refill(now));
  }

  /**
   * Try to consume `tokens` tokens. Returns true if allowed (and
   * decrements), false if not (state unchanged).
   */
  tryAcquire(tokens: number = 1, now: number = Date.now()): boolean {
    if (!Number.isFinite(tokens) || tokens < 0) {
      throw new RangeError(`LeakyBucket.tryAcquire: tokens must be >= 0, got ${tokens}`);
    }
    this.advance(now);
    if (this.tokens + 1e-9 < tokens) return false; // small slack for float math
    this.tokens -= tokens;
    if (this.tokens < 0) this.tokens = 0; // numerical drift guard
    return true;
  }

  /** Force a clock advance without consuming. Returns refilled tokens. */
  advance(now: number = Date.now()): number {
    if (now <= this.lastNowMs) return 0;
    const refilled = this.refill(now);
    this.tokens = Math.min(this.capacity, this.tokens + refilled);
    this.lastNowMs = now;
    return refilled;
  }

  private refill(now: number): number {
    if (now <= this.lastNowMs) return 0;
    const elapsedSec = (now - this.lastNowMs) / 1000;
    return elapsedSec * this.refillPerSec;
  }
}
