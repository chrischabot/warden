/**
 * Outcome recorders.
 *
 * Two implementations:
 *
 * 1. `BufferedOutcomeRecorder` keeps every `record()` call verbatim
 *    in memory. Useful for tests and small-volume diagnostics.
 *
 * 2. `AggregatingOutcomeRecorder` aggregates by
 *    `(projectId, dataCategory, reason, time-bucket)`, where the
 *    bucket is a fixed-width window (default 1 minute). On `flush()`,
 *    the aggregated counts are handed to an injected callback as
 *    fully-resolved `Outcome[]`. The aggregator suits the spec's
 *    "one outcome row per item, mirrored across the fleet" model —
 *    callers record once per item; the aggregator collapses to
 *    a row per (key, bucket).
 */

import type { Outcome, OutcomeRecorder, RecordedOutcome } from './types';

export class BufferedOutcomeRecorder implements OutcomeRecorder {
  private readonly outcomes: Outcome[] = [];

  record(o: RecordedOutcome): void {
    this.outcomes.push(resolveOutcome(o));
  }

  /** All recorded outcomes (defensive copy). */
  drain(): Outcome[] {
    const out = this.outcomes.slice();
    this.outcomes.length = 0;
    return out;
  }

  /** Read without draining. Useful for tests. */
  peek(): readonly Outcome[] {
    return this.outcomes;
  }
}

export interface AggregatingOutcomeRecorderConfig {
  /** Bucket width in milliseconds. Default 60_000 (1 minute). */
  readonly bucketMs?: number;
  /** Callback invoked on `flush()` with the aggregated records. */
  readonly onFlush: (records: readonly Outcome[]) => void | Promise<void>;
}

export class AggregatingOutcomeRecorder implements OutcomeRecorder {
  private readonly bucketMs: number;
  private readonly onFlush: AggregatingOutcomeRecorderConfig['onFlush'];
  private readonly counters = new Map<string, MutableOutcome>();

  constructor(config: AggregatingOutcomeRecorderConfig) {
    this.bucketMs = config.bucketMs ?? 60_000;
    if (!Number.isFinite(this.bucketMs) || this.bucketMs <= 0) {
      throw new RangeError(`AggregatingOutcomeRecorder: bucketMs must be > 0`);
    }
    this.onFlush = config.onFlush;
  }

  record(o: RecordedOutcome): void {
    const timestamp = o.timestamp ?? Date.now();
    const bucket = Math.floor(timestamp / this.bucketMs) * this.bucketMs;
    const key = `${o.projectId}\u0000${o.dataCategory}\u0000${o.reason}\u0000${bucket}`;
    const existing = this.counters.get(key);
    const quantity = o.quantity ?? 1;
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.counters.set(key, {
        timestamp: bucket,
        projectId: o.projectId,
        dataCategory: o.dataCategory,
        reason: o.reason,
        quantity,
      });
    }
  }

  /** Flush aggregated counters to the downstream callback and clear state. */
  async flush(): Promise<void> {
    if (this.counters.size === 0) return;
    const records: Outcome[] = [];
    for (const v of this.counters.values()) {
      records.push(Object.freeze({ ...v }));
    }
    this.counters.clear();
    await this.onFlush(records);
  }

  /** Number of distinct (project, category, reason, bucket) keys held. */
  get pendingKeyCount(): number {
    return this.counters.size;
  }
}

// ---- internals ----

interface MutableOutcome {
  timestamp: number;
  projectId: string;
  dataCategory: string;
  reason: import('./types').OutcomeReason;
  quantity: number;
}

function resolveOutcome(o: RecordedOutcome): Outcome {
  return Object.freeze({
    timestamp: o.timestamp ?? Date.now(),
    projectId: o.projectId,
    dataCategory: o.dataCategory,
    reason: o.reason,
    quantity: o.quantity ?? 1,
  });
}
