import { beforeEach, describe, expect, test } from 'bun:test';
import { MetricStore } from '../src/store';
import type {
  CounterBucket,
  DistributionBucket,
  GaugeBucket,
  MetricSample,
  SetBucket,
} from '../src/types';

function sample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    projectId: '1',
    name: 'requests',
    type: 'counter',
    value: 1,
    timestamp: 1_000_000,
    ...overrides,
  };
}

describe('MetricStore — counters', () => {
  let store: MetricStore;
  beforeEach(() => {
    store = new MetricStore({ bucketMs: 10_000 });
  });

  test('two samples in the same bucket sum', () => {
    store.record(sample({ value: 1, timestamp: 1_000_000 }));
    store.record(sample({ value: 3, timestamp: 1_005_000 }));
    const buckets = store.query({ name: 'requests' });
    expect(buckets.length).toBe(1);
    expect((buckets[0] as CounterBucket).sum).toBe(4);
  });

  test('samples in different buckets split', () => {
    store.record(sample({ value: 1, timestamp: 1_000_000 }));
    store.record(sample({ value: 1, timestamp: 1_015_000 }));
    expect(store.query({ name: 'requests' }).length).toBe(2);
  });

  test('different tag sets create distinct buckets', () => {
    store.record(sample({ value: 1, tags: { region: 'eu' } }));
    store.record(sample({ value: 1, tags: { region: 'us' } }));
    expect(store.size()).toBe(2);
    expect(store.query({ tagKey: 'region', tagValue: 'eu' }).length).toBe(1);
  });

  test('canonical-key tag ordering is order-independent', () => {
    store.record(sample({ value: 1, tags: { a: '1', b: '2' } }));
    store.record(sample({ value: 1, tags: { b: '2', a: '1' } }));
    expect(store.size()).toBe(1);
    expect((store.query()[0] as CounterBucket).sum).toBe(2);
  });
});

describe('MetricStore — gauges', () => {
  test('tracks min/max/last/sum/count', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    store.record({ ...sample({ type: 'gauge', name: 'queue_depth', value: 10 }) });
    store.record({ ...sample({ type: 'gauge', name: 'queue_depth', value: 5 }) });
    store.record({ ...sample({ type: 'gauge', name: 'queue_depth', value: 20 }) });
    const buckets = store.query({ type: 'gauge' });
    const g = buckets[0] as GaugeBucket;
    expect(g.min).toBe(5);
    expect(g.max).toBe(20);
    expect(g.last).toBe(20);
    expect(g.sum).toBe(35);
    expect(g.count).toBe(3);
  });
});

describe('MetricStore — distributions', () => {
  test('appends raw values', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    for (let i = 1; i <= 10; i++) {
      store.record({ ...sample({ type: 'distribution', name: 'lat', value: i }) });
    }
    const b = store.query({ type: 'distribution' })[0] as DistributionBucket;
    expect(b.values.length).toBe(10);
    expect(b.values).toContain(1);
    expect(b.values).toContain(10);
  });
});

describe('MetricStore — sets', () => {
  test('cardinality is members.size', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    store.record({ ...sample({ type: 'set', name: 'users', value: 1 }) });
    store.record({ ...sample({ type: 'set', name: 'users', value: 2 }) });
    store.record({ ...sample({ type: 'set', name: 'users', value: 1 }) });
    const b = store.query({ type: 'set' })[0] as SetBucket;
    expect(b.members.size).toBe(2);
  });
});

describe('MetricStore — query', () => {
  test('time range filters by bucket', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    store.record(sample({ value: 1, timestamp: 1_000_000 }));
    store.record(sample({ value: 1, timestamp: 1_015_000 }));
    store.record(sample({ value: 1, timestamp: 1_025_000 }));
    expect(store.query({ sinceTimestamp: 1_010_000, untilTimestamp: 1_020_000 }).length).toBe(1);
  });

  test('rejects bad bucketMs', () => {
    expect(() => new MetricStore({ bucketMs: 0 })).toThrow(RangeError);
    expect(() => new MetricStore({ bucketMs: -1 })).toThrow(RangeError);
  });
});
