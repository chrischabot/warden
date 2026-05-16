/**
 * Custom metrics types per spec §5.11.
 *
 * Sentry's user-emitted metrics follow the Statsd model:
 *
 *   - counter:      monotonically increasing scalar
 *   - gauge:        last-write-wins scalar
 *   - distribution: full distribution of values (used for histograms)
 *   - set:          cardinality of distinct values
 *
 * Each metric is keyed by `(project_id, name, unit, tags)` where
 * `tags` are key=value pairs (a canonical serialisation enforces
 * order-independence). Values are accumulated into time buckets
 * (default 10 s wide).
 */

export type MetricType = 'counter' | 'gauge' | 'distribution' | 'set';

export interface MetricKey {
  readonly projectId: string;
  readonly name: string;
  readonly type: MetricType;
  readonly unit?: string;
  readonly tags?: Readonly<Record<string, string>>;
}

export interface MetricSample extends MetricKey {
  readonly value: number;
  readonly timestamp: number;
}

/** A bucketed counter aggregate. */
export interface CounterBucket {
  readonly key: MetricKey;
  readonly bucketStart: number;
  readonly bucketEnd: number;
  sum: number;
}

/** A bucketed gauge aggregate — min/max/last/sum/count. */
export interface GaugeBucket {
  readonly key: MetricKey;
  readonly bucketStart: number;
  readonly bucketEnd: number;
  min: number;
  max: number;
  last: number;
  sum: number;
  count: number;
}

/** A bucketed distribution — keeps the raw values for percentile queries. */
export interface DistributionBucket {
  readonly key: MetricKey;
  readonly bucketStart: number;
  readonly bucketEnd: number;
  values: number[];
}

/** A bucketed set — cardinality via a Set, with raw values for merging. */
export interface SetBucket {
  readonly key: MetricKey;
  readonly bucketStart: number;
  readonly bucketEnd: number;
  members: Set<string>;
}

export type Bucket = CounterBucket | GaugeBucket | DistributionBucket | SetBucket;

export interface MetricQuery {
  readonly projectId?: string;
  readonly name?: string;
  readonly type?: MetricType;
  readonly tagKey?: string;
  readonly tagValue?: string;
  readonly sinceTimestamp?: number;
  readonly untilTimestamp?: number;
}

/** Canonical serialisation of (name, type, unit, tags) for keying. */
export function canonicalKey(key: MetricKey): string {
  const tagPart = key.tags
    ? Object.keys(key.tags)
        .sort()
        .map((k) => `${k}=${(key.tags as Record<string, string>)[k]}`)
        .join(',')
    : '';
  return `${key.projectId}|${key.name}|${key.type}|${key.unit ?? ''}|${tagPart}`;
}
