/**
 * Operational metrics for the columnar store.
 *
 * Registered against the shared `@sr/metrics` registry under the
 * `sr_store_*` namespace per spec §2.8. Module-load registration
 * is intentional — the metrics exist whether or not anything has
 * been written to them yet, so `/internal/metrics` surfaces them
 * from process startup.
 *
 * Spec-listed metrics:
 *   - sr_store_write_latency_seconds  histogram
 *   - sr_store_memtable_bytes         gauge
 *   - sr_store_segment_count          gauge
 *   - sr_store_compaction_debt_segments gauge
 *   - sr_store_query_latency_seconds  histogram
 *
 * Plus convenience timers for compaction merge:
 *   - sr_store_compaction_latency_seconds histogram
 */

import { gauge, histogram } from '@sr/metrics';

export const storeWriteLatencySeconds = histogram<'op' | 'shard'>({
  name: 'store_write_latency_seconds',
  help: 'Latency of MemTable write paths (addRow, addBatch, buildSegment).',
  labelNames: ['op', 'shard'] as const,
  buckets: [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});

export const storeMemtableBytes = gauge<'shard'>({
  name: 'store_memtable_bytes',
  help: 'Current MemTable byte size per shard.',
  labelNames: ['shard'] as const,
});

export const storeSegmentCount = gauge<'project_id' | 'tier'>({
  name: 'store_segment_count',
  help: 'Number of segments on disk per (project, tier).',
  labelNames: ['project_id', 'tier'] as const,
});

export const storeCompactionDebtSegments = gauge<'tier'>({
  name: 'store_compaction_debt_segments',
  help: 'Number of segments awaiting compaction at a given tier.',
  labelNames: ['tier'] as const,
});

export const storeQueryLatencySeconds = histogram<'op'>({
  name: 'store_query_latency_seconds',
  help: 'End-to-end query execution latency.',
  labelNames: ['op'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const storeCompactionLatencySeconds = histogram<'source_count'>({
  name: 'store_compaction_latency_seconds',
  help: 'Compaction merge latency, labelled by source-segment count bucket.',
  labelNames: ['source_count'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300],
});

/**
 * Bucket a numeric source count into a coarse label value so the
 * histogram cardinality stays bounded.
 */
export function sourceCountBucket(n: number): string {
  if (n <= 2) return '2';
  if (n <= 4) return '4';
  if (n <= 8) return '8';
  if (n <= 16) return '16';
  if (n <= 32) return '32';
  return '32+';
}
