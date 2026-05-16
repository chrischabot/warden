/**
 * Performance issue detectors.
 *
 * Sentry's performance product surfaces a curated set of automatic
 * issues — slow DB queries, N+1 query loops, render blocking
 * assets, etc. (spec §5.2 "perf-issues"). This is the lightweight
 * first cut covering the two highest-value detectors. Each detector
 * is a pure function over `Span[]`.
 *
 * Slow query: any span with `op === 'db'` whose `duration_ms`
 * exceeds `slowQueryMs` (default 500).
 *
 * N+1: ≥ `minRepeats` (default 5) consecutive sibling spans with
 * `op === 'db'` and identical `description`. We require them to
 * share a `parent_span_id` so a parallel batch on different
 * parents doesn't trigger a false positive.
 */

import type { Span } from './types';

export interface PerformanceIssue {
  readonly kind: 'slow-query' | 'n-plus-one';
  readonly traceId: string;
  readonly representativeSpanId: string;
  readonly description: string;
  /** Total wall-clock span the issue covers (max of contributing durations). */
  readonly impactMs: number;
  /** For n-plus-one, number of repeated queries. */
  readonly count?: number;
}

export interface DetectorOptions {
  /** db span duration threshold for the slow-query detector. Default 500 ms. */
  readonly slowQueryMs?: number;
  /** Minimum sibling repeats to fire the N+1 detector. Default 5. */
  readonly minNPlusOneRepeats?: number;
}

export function detect(
  traceId: string,
  spans: readonly Span[],
  options: DetectorOptions = {},
): PerformanceIssue[] {
  const out: PerformanceIssue[] = [];
  out.push(...detectSlowQueries(traceId, spans, options));
  out.push(...detectNPlusOne(traceId, spans, options));
  return out;
}

export function detectSlowQueries(
  traceId: string,
  spans: readonly Span[],
  options: DetectorOptions = {},
): PerformanceIssue[] {
  const threshold = options.slowQueryMs ?? 500;
  const out: PerformanceIssue[] = [];
  for (const s of spans) {
    if (s.op === 'db' && s.durationMs >= threshold) {
      out.push({
        kind: 'slow-query',
        traceId,
        representativeSpanId: s.spanId,
        description: s.description ?? '(unknown query)',
        impactMs: s.durationMs,
      });
    }
  }
  return out;
}

export function detectNPlusOne(
  traceId: string,
  spans: readonly Span[],
  options: DetectorOptions = {},
): PerformanceIssue[] {
  const minRepeats = options.minNPlusOneRepeats ?? 5;
  // Group sibling spans by (parent, op=db, description).
  const buckets = new Map<string, Span[]>();
  for (const s of spans) {
    if (s.op !== 'db') continue;
    const desc = s.description ?? '';
    if (!desc) continue;
    const key = `${s.parentSpanId ?? '~root'}\u0000${desc}`;
    const arr = buckets.get(key) ?? [];
    arr.push(s);
    buckets.set(key, arr);
  }
  const out: PerformanceIssue[] = [];
  for (const arr of buckets.values()) {
    if (arr.length < minRepeats) continue;
    let total = 0;
    for (const s of arr) total += s.durationMs;
    const first = arr[0] as Span;
    out.push({
      kind: 'n-plus-one',
      traceId,
      representativeSpanId: first.spanId,
      description: first.description ?? '',
      impactMs: total,
      count: arr.length,
    });
  }
  return out;
}
