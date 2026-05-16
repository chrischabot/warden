/**
 * Custom-metrics store. Time-bucketed.
 *
 * Calling `record(sample)` finds (or creates) the bucket for the
 * sample's `(canonicalKey, bucketStart)` and accumulates the value
 * per type:
 *
 *   counter      → bucket.sum += value
 *   gauge        → tracks min/max/last/sum/count for percentile-of-gauge queries
 *   distribution → push raw value
 *   set          → add stringified value
 *
 * Stringification for the set type uses `String(value)`; an integer
 * 42 and the string "42" therefore alias. Callers wanting strict
 * separation should hash externally.
 */

import type {
  Bucket,
  CounterBucket,
  DistributionBucket,
  GaugeBucket,
  MetricKey,
  MetricQuery,
  MetricSample,
  SetBucket,
} from './types';
import { canonicalKey } from './types';

export interface MetricStoreOptions {
  /** Bucket width in ms. Default 10_000 (10 s). */
  readonly bucketMs?: number;
}

export class MetricStore {
  private readonly bucketMs: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: MetricStoreOptions = {}) {
    this.bucketMs = options.bucketMs ?? 10_000;
    if (this.bucketMs <= 0 || !Number.isFinite(this.bucketMs)) {
      throw new RangeError(`MetricStore: bucketMs must be positive, got ${this.bucketMs}`);
    }
  }

  record(sample: MetricSample): void {
    const bucketStart = Math.floor(sample.timestamp / this.bucketMs) * this.bucketMs;
    const bucketKey = `${canonicalKey(sample)}|${bucketStart}`;
    const existing = this.buckets.get(bucketKey);
    const key: MetricKey = {
      projectId: sample.projectId,
      name: sample.name,
      type: sample.type,
      ...(sample.unit !== undefined ? { unit: sample.unit } : {}),
      ...(sample.tags ? { tags: sample.tags } : {}),
    };
    if (!existing) {
      this.buckets.set(
        bucketKey,
        this.freshBucket(key, bucketStart, bucketStart + this.bucketMs, sample.value),
      );
      return;
    }
    this.applyToBucket(existing, sample.value);
  }

  query(query: MetricQuery = {}): readonly Bucket[] {
    const out: Bucket[] = [];
    for (const b of this.buckets.values()) {
      const k = b.key;
      if (query.projectId !== undefined && k.projectId !== query.projectId) continue;
      if (query.name !== undefined && k.name !== query.name) continue;
      if (query.type !== undefined && k.type !== query.type) continue;
      if (query.tagKey !== undefined) {
        if (!k.tags || k.tags[query.tagKey] !== query.tagValue) continue;
      }
      if (query.sinceTimestamp !== undefined && b.bucketEnd <= query.sinceTimestamp) {
        continue;
      }
      if (query.untilTimestamp !== undefined && b.bucketStart >= query.untilTimestamp) {
        continue;
      }
      out.push(b);
    }
    out.sort((a, b) => a.bucketStart - b.bucketStart);
    return Object.freeze(out);
  }

  size(): number {
    return this.buckets.size;
  }

  private freshBucket(
    key: MetricKey,
    bucketStart: number,
    bucketEnd: number,
    value: number,
  ): Bucket {
    switch (key.type) {
      case 'counter': {
        const b: CounterBucket = { key, bucketStart, bucketEnd, sum: value };
        return b;
      }
      case 'gauge': {
        const b: GaugeBucket = {
          key,
          bucketStart,
          bucketEnd,
          min: value,
          max: value,
          last: value,
          sum: value,
          count: 1,
        };
        return b;
      }
      case 'distribution': {
        const b: DistributionBucket = { key, bucketStart, bucketEnd, values: [value] };
        return b;
      }
      case 'set': {
        const b: SetBucket = {
          key,
          bucketStart,
          bucketEnd,
          members: new Set([String(value)]),
        };
        return b;
      }
    }
  }

  private applyToBucket(bucket: Bucket, value: number): void {
    switch (bucket.key.type) {
      case 'counter':
        (bucket as CounterBucket).sum += value;
        return;
      case 'gauge': {
        const g = bucket as GaugeBucket;
        g.min = Math.min(g.min, value);
        g.max = Math.max(g.max, value);
        g.last = value;
        g.sum += value;
        g.count += 1;
        return;
      }
      case 'distribution':
        (bucket as DistributionBucket).values.push(value);
        return;
      case 'set':
        (bucket as SetBucket).members.add(String(value));
        return;
    }
  }
}
