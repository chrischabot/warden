import { beforeEach, describe, expect, test } from 'bun:test';
import {
  contentType,
  counter,
  gauge,
  histogram,
  LATENCY_BUCKETS,
  registry,
  renderText,
  SIZE_BUCKETS,
  summary,
} from '../src/index';

beforeEach(() => {
  registry.clear();
});

describe('namespace', () => {
  test('counter registers under sr_ prefix', async () => {
    const c = counter({ name: 'test_counter_total', help: 'test counter' });
    c.inc();
    c.inc(2);
    const text = await renderText();
    expect(text).toContain('# HELP sr_test_counter_total test counter');
    expect(text).toContain('# TYPE sr_test_counter_total counter');
    expect(text).toMatch(/sr_test_counter_total 3\b/);
  });

  test('gauge with labels renders each label set', async () => {
    const g = gauge<'shard'>({
      name: 'test_gauge',
      help: 'test gauge',
      labelNames: ['shard'],
    });
    g.set({ shard: '0' }, 42);
    g.set({ shard: '1' }, 99);
    const text = await renderText();
    expect(text).toMatch(/sr_test_gauge\{shard="0"\} 42/);
    expect(text).toMatch(/sr_test_gauge\{shard="1"\} 99/);
  });
});

describe('histogram defaults', () => {
  test('uses latency buckets when none specified', async () => {
    const h = histogram({ name: 'test_latency_seconds', help: 'test latency' });
    h.observe(0.001);
    h.observe(0.01);
    h.observe(0.1);
    const text = await renderText();
    expect(text).toContain('sr_test_latency_seconds_bucket');
    expect(text).toContain('le="0.001"');
    expect(text).toContain('le="0.01"');
    expect(text).toContain('le="0.1"');
    expect(text).toContain('le="+Inf"');
  });

  test('accepts custom buckets', async () => {
    const h = histogram({
      name: 'test_bytes',
      help: 'test size',
      buckets: SIZE_BUCKETS,
    });
    h.observe(128);
    const text = await renderText();
    expect(text).toContain('le="64"');
    expect(text).toContain('le="256"');
    expect(text).toContain('le="67108864"');
  });
});

describe('summary defaults', () => {
  test('uses p50/p90/p95/p99/p999 by default', async () => {
    const s = summary({ name: 'test_summary_seconds', help: 'test' });
    for (let i = 0; i < 100; i++) s.observe(i / 100);
    const text = await renderText();
    expect(text).toContain('quantile="0.5"');
    expect(text).toContain('quantile="0.9"');
    expect(text).toContain('quantile="0.95"');
    expect(text).toContain('quantile="0.99"');
    expect(text).toContain('quantile="0.999"');
  });
});

describe('bucket constants', () => {
  test('LATENCY_BUCKETS span 100µs to 10s', () => {
    expect(LATENCY_BUCKETS[0]).toBe(0.0001);
    expect(LATENCY_BUCKETS[LATENCY_BUCKETS.length - 1]).toBe(10);
  });

  test('SIZE_BUCKETS span 64B to 64MiB', () => {
    expect(SIZE_BUCKETS[0]).toBe(64);
    expect(SIZE_BUCKETS[SIZE_BUCKETS.length - 1]).toBe(67_108_864);
  });

  test('latency buckets are strictly increasing', () => {
    for (let i = 1; i < LATENCY_BUCKETS.length; i++) {
      const prev = LATENCY_BUCKETS[i - 1];
      const curr = LATENCY_BUCKETS[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      expect(curr as number).toBeGreaterThan(prev as number);
    }
  });

  test('size buckets are strictly increasing', () => {
    for (let i = 1; i < SIZE_BUCKETS.length; i++) {
      const prev = SIZE_BUCKETS[i - 1];
      const curr = SIZE_BUCKETS[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      expect(curr as number).toBeGreaterThan(prev as number);
    }
  });
});

describe('contentType', () => {
  test('is the Prometheus text-format content type', () => {
    expect(contentType).toContain('text/plain');
    expect(contentType).toContain('version=');
  });
});
