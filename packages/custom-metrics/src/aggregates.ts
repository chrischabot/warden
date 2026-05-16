/**
 * Time-series rollups across one or more buckets.
 *
 * `series` aggregates the buckets of one metric into a time series
 * with the configured `pointsMs` resolution. Each bucket's value
 * collapses to a scalar per type:
 *
 *   counter      → sum
 *   gauge        → last (or .avg() / .max() variants)
 *   distribution → percentile / avg / count
 *   set          → cardinality (size)
 */

import type { Bucket, MetricType } from './types';

export interface TimeSeriesPoint {
  readonly timestamp: number;
  readonly value: number;
}

export interface SeriesOptions {
  /** Output resolution. Default 60_000 (1 minute). */
  readonly pointsMs?: number;
  /**
   * Reducer applied at the point level after summarising buckets:
   *   - counter, set: sum (counters add; set values are merged into a
   *                   single de-duplicated member set within the window
   *                   and the cardinality is reported)
   *   - gauge: 'last' (default), 'avg', 'min', 'max'
   *   - distribution: 'p50' | 'p75' | 'p95' | 'p99' | 'avg' | 'count'
   */
  readonly reducer?:
    | 'sum'
    | 'last'
    | 'avg'
    | 'min'
    | 'max'
    | 'p50'
    | 'p75'
    | 'p95'
    | 'p99'
    | 'count';
}

export function series(
  buckets: readonly Bucket[],
  type: MetricType,
  options: SeriesOptions = {},
): readonly TimeSeriesPoint[] {
  const points = options.pointsMs ?? 60_000;
  const reducer = options.reducer ?? defaultReducerFor(type);
  // Group buckets by point bucket aligned to `points`.
  const grouped = new Map<number, Bucket[]>();
  for (const b of buckets) {
    const point = Math.floor(b.bucketStart / points) * points;
    const arr = grouped.get(point) ?? [];
    arr.push(b);
    grouped.set(point, arr);
  }
  const out: TimeSeriesPoint[] = [];
  for (const [timestamp, bs] of grouped.entries()) {
    out.push({ timestamp, value: reducePoint(bs, type, reducer) });
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return Object.freeze(out);
}

function defaultReducerFor(type: MetricType): SeriesOptions['reducer'] {
  switch (type) {
    case 'counter':
      return 'sum';
    case 'gauge':
      return 'last';
    case 'distribution':
      return 'p95';
    case 'set':
      return 'sum';
  }
}

function reducePoint(
  buckets: Bucket[],
  type: MetricType,
  reducer: SeriesOptions['reducer'],
): number {
  switch (type) {
    case 'counter':
      return buckets.reduce((s, b) => s + (b as { sum: number }).sum, 0);
    case 'gauge': {
      const gs = buckets as Array<{
        last: number;
        min: number;
        max: number;
        sum: number;
        count: number;
      }>;
      if (gs.length === 0) return 0;
      if (reducer === 'min') return Math.min(...gs.map((g) => g.min));
      if (reducer === 'max') return Math.max(...gs.map((g) => g.max));
      if (reducer === 'avg') {
        const sum = gs.reduce((s, g) => s + g.sum, 0);
        const count = gs.reduce((s, g) => s + g.count, 0);
        return count === 0 ? 0 : sum / count;
      }
      // 'last' falls back to the last-seen value across all buckets at this point.
      return gs[gs.length - 1]!.last;
    }
    case 'distribution': {
      const all: number[] = [];
      for (const b of buckets) {
        all.push(...(b as { values: number[] }).values);
      }
      if (all.length === 0) return 0;
      if (reducer === 'count') return all.length;
      if (reducer === 'avg') return all.reduce((s, v) => s + v, 0) / all.length;
      if (reducer === 'sum') return all.reduce((s, v) => s + v, 0);
      const q =
        reducer === 'p50'
          ? 0.5
          : reducer === 'p75'
            ? 0.75
            : reducer === 'p95'
              ? 0.95
              : reducer === 'p99'
                ? 0.99
                : 0.5;
      return percentile(all, q);
    }
    case 'set': {
      const merged = new Set<string>();
      for (const b of buckets) {
        for (const m of (b as { members: Set<string> }).members) merged.add(m);
      }
      return merged.size;
    }
  }
}

function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  if (lo === hi) return sorted[lo] as number;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}
