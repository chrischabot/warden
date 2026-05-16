import { describe, expect, test } from 'bun:test';
import { series } from '../src/aggregates';
import { MetricStore } from '../src/store';

describe('series', () => {
  test('counter sums into per-minute points', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    // Six samples all within the first minute → one rollup point.
    for (let i = 0; i < 6; i++) {
      store.record({
        projectId: '1',
        name: 'c',
        type: 'counter',
        value: 1,
        timestamp: i * 1000,
      });
    }
    const pts = series(store.query({ type: 'counter' }), 'counter', { pointsMs: 60_000 });
    expect(pts.length).toBe(1);
    expect(pts[0]?.value).toBe(6);
  });

  test('gauge default reducer is last-seen', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    store.record({
      projectId: '1',
      name: 'g',
      type: 'gauge',
      value: 10,
      timestamp: 1_000_000,
    });
    store.record({
      projectId: '1',
      name: 'g',
      type: 'gauge',
      value: 20,
      timestamp: 1_000_500,
    });
    const pts = series(store.query({ type: 'gauge' }), 'gauge', { pointsMs: 60_000 });
    expect(pts[0]?.value).toBe(20);
  });

  test('gauge reducer=avg uses sum/count across the point', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    store.record({ projectId: '1', name: 'g', type: 'gauge', value: 10, timestamp: 0 });
    store.record({ projectId: '1', name: 'g', type: 'gauge', value: 20, timestamp: 1 });
    store.record({ projectId: '1', name: 'g', type: 'gauge', value: 30, timestamp: 2 });
    const pts = series(store.query({ type: 'gauge' }), 'gauge', {
      pointsMs: 60_000,
      reducer: 'avg',
    });
    expect(pts[0]?.value).toBe(20);
  });

  test('distribution p95 collapses all values in window', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    for (let i = 1; i <= 100; i++) {
      store.record({
        projectId: '1',
        name: 'd',
        type: 'distribution',
        value: i,
        timestamp: 1_000_000 + (i % 10) * 10_000,
      });
    }
    const pts = series(store.query({ type: 'distribution' }), 'distribution', {
      pointsMs: 1_000_000, // wide enough to coalesce
      reducer: 'p95',
    });
    expect(pts[0]?.value).toBeGreaterThan(90);
    expect(pts[0]?.value).toBeLessThanOrEqual(100);
  });

  test('set sums member cardinalities (de-duplicated across window)', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    store.record({ projectId: '1', name: 's', type: 'set', value: 1, timestamp: 0 });
    store.record({ projectId: '1', name: 's', type: 'set', value: 2, timestamp: 0 });
    store.record({ projectId: '1', name: 's', type: 'set', value: 2, timestamp: 1 });
    const pts = series(store.query({ type: 'set' }), 'set', { pointsMs: 60_000 });
    expect(pts[0]?.value).toBe(2);
  });

  test('multiple points emitted in sorted order', () => {
    const store = new MetricStore({ bucketMs: 10_000 });
    for (let i = 0; i < 10; i++) {
      store.record({
        projectId: '1',
        name: 'c',
        type: 'counter',
        value: 1,
        timestamp: i * 60_000,
      });
    }
    const pts = series(store.query({ type: 'counter' }), 'counter', { pointsMs: 60_000 });
    expect(pts.length).toBe(10);
    for (let i = 1; i < pts.length; i++) {
      expect((pts[i] as { timestamp: number }).timestamp).toBeGreaterThan(
        (pts[i - 1] as { timestamp: number }).timestamp,
      );
    }
  });
});
