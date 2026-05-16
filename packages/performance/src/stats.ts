/**
 * Performance statistics.
 *
 *   percentile(values, q)         — q-th percentile via linear interpolation,
 *                                   matching Sentry's `quantile` aggregate.
 *   throughputPerMinute(...)      — events per minute over the chosen window.
 *   failureRate(transactions)     — fraction of transactions whose status is
 *                                   not `ok` (matches Sentry's `failure_rate`).
 *   apdex(values, threshold)      — Apdex score over the duration distribution:
 *                                     (satisfied + tolerating/2) / total
 *                                   `satisfied`   = duration ≤ T
 *                                   `tolerating`  = T < duration ≤ 4T
 *                                   `frustrated`  = duration > 4T
 *
 * All four are pure functions over arrays / TypedArrays of numbers
 * so they slot directly into the columnar query path in Ring 1
 * (the columnar layer feeds in Float64Array views).
 */

import type { SpanStatus, Transaction } from './types';

export function percentile(values: ArrayLike<number>, q: number): number {
  if (q < 0 || q > 1 || !Number.isFinite(q)) {
    throw new RangeError(`percentile: q must be in [0, 1], got ${q}`);
  }
  if (values.length === 0) return NaN;
  const sorted = Array.from(values as ArrayLike<number>);
  sorted.sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  if (lo === hi) return sorted[lo] as number;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

export function throughputPerMinute(timestamps: ArrayLike<number>): number {
  if (timestamps.length === 0) return 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i] as number;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (min === max) return timestamps.length; // sub-second; report count
  const minutes = (max - min) / 60_000;
  return minutes > 0 ? timestamps.length / minutes : timestamps.length;
}

export function failureRate(txs: readonly Transaction[]): number {
  if (txs.length === 0) return 0;
  let failed = 0;
  for (const tx of txs) {
    if (isFailedStatus(tx.status)) failed++;
  }
  return failed / txs.length;
}

export function isFailedStatus(status: SpanStatus): boolean {
  switch (status) {
    case 'ok':
    case 'cancelled':
    case 'unknown':
      return false;
    default:
      return true;
  }
}

export function apdex(durationsMs: ArrayLike<number>, thresholdMs: number): number {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    throw new RangeError(`apdex: threshold must be a positive finite number, got ${thresholdMs}`);
  }
  if (durationsMs.length === 0) return 1.0;
  const tolerating = 4 * thresholdMs;
  let s = 0;
  let t = 0;
  for (let i = 0; i < durationsMs.length; i++) {
    const d = durationsMs[i] as number;
    if (d <= thresholdMs) s++;
    else if (d <= tolerating) t++;
    // else: frustrated, ignored in the numerator
  }
  return (s + t / 2) / durationsMs.length;
}

/** Convenience aggregator over an array of transactions. */
export interface TransactionAggregate {
  readonly count: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
  readonly p99: number;
  readonly avg: number;
  readonly min: number;
  readonly max: number;
  readonly failureRate: number;
  readonly throughputPerMinute: number;
  readonly apdex: number;
}

export interface AggregateOptions {
  /** Apdex threshold in ms. Default 300 ms (Sentry's standard). */
  readonly apdexThresholdMs?: number;
}

export function aggregateTransactions(
  txs: readonly Transaction[],
  options: AggregateOptions = {},
): TransactionAggregate {
  const threshold = options.apdexThresholdMs ?? 300;
  if (txs.length === 0) {
    return Object.freeze({
      count: 0,
      p50: NaN,
      p75: NaN,
      p95: NaN,
      p99: NaN,
      avg: NaN,
      min: NaN,
      max: NaN,
      failureRate: 0,
      throughputPerMinute: 0,
      apdex: 1.0,
    });
  }
  const durations = new Float64Array(txs.length);
  const timestamps = new Float64Array(txs.length);
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i] as Transaction;
    const d = tx.durationMs;
    durations[i] = d;
    timestamps[i] = tx.startTimestamp;
    sum += d;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return Object.freeze({
    count: txs.length,
    p50: percentile(durations, 0.5),
    p75: percentile(durations, 0.75),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    avg: sum / txs.length,
    min,
    max,
    failureRate: failureRate(txs),
    throughputPerMinute: throughputPerMinute(timestamps),
    apdex: apdex(durations, threshold),
  });
}
