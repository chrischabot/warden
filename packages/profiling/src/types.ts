/**
 * Profiling types per spec §5.3.
 *
 * A profile is a sequence of stack samples, each captured at some
 * `relativeTsNs` from profile start. A sample's stack is an array
 * of frame ids (smallest = top of stack / currently executing
 * function; largest = root). The associated `Frame` table is
 * shared across all samples to avoid string duplication.
 *
 * Sampling rate is typically 101 Hz (i.e. one sample every ~9.9 ms)
 * to avoid lock-step bias.
 */

export interface Frame {
  /** Stable index into the frame table; never re-used. */
  readonly id: number;
  readonly function?: string;
  readonly module?: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly inApp?: boolean;
}

export interface Thread {
  readonly id: number;
  readonly name?: string;
}

/** One sample. The `stack` is interpreted top-of-stack to root. */
export interface Sample {
  readonly threadId: number;
  /** Nanoseconds since profile start. */
  readonly relativeTsNs: number;
  /** Frame ids; index 0 = top of stack. */
  readonly stack: readonly number[];
}

export interface Profile {
  readonly id: string;
  readonly projectId: string;
  readonly traceId?: string;
  readonly transactionName?: string;
  readonly platform: string;
  readonly capturedAt: number;
  readonly durationNs: number;
  readonly samplingRateHz: number;
  readonly frames: readonly Frame[];
  readonly threads: readonly Thread[];
  readonly samples: readonly Sample[];
  readonly release?: string;
  readonly environment?: string;
}

export interface ProfileQuery {
  readonly projectId?: string;
  readonly transactionName?: string;
  readonly platform?: string;
  readonly traceId?: string;
  readonly sinceTimestamp?: number;
  readonly untilTimestamp?: number;
}
