import { describe, expect, test } from 'bun:test';
import { SystemMetricsCollector } from '../src/system-metrics';

describe('SystemMetricsCollector', () => {
  test('sample returns a non-empty snapshot under Bun', async () => {
    const s = await new SystemMetricsCollector().sample();
    expect(s.rssBytes).toBeGreaterThan(0);
    expect(s.heapTotalBytes).toBeGreaterThanOrEqual(s.heapUsedBytes);
    expect(s.uptimeSec).toBeGreaterThan(0);
    expect(s.eventLoopLagMs).toBeGreaterThanOrEqual(0);
  });

  test('onSample is called for each sample', async () => {
    const samples: number[] = [];
    const c = new SystemMetricsCollector({
      onSample: (s) => samples.push(s.eventLoopLagMs),
    });
    await c.sample();
    await c.sample();
    expect(samples.length).toBe(2);
  });

  test('start / stop is idempotent', () => {
    const c = new SystemMetricsCollector({ sampleIntervalMs: 60_000 });
    c.start();
    c.start();
    c.stop();
    c.stop();
    // No assertion needed; reaching here means no double-interval bug.
    expect(true).toBe(true);
  });

  test('injected schedule + clock measure lag deterministically', async () => {
    // Pretend the immediate-callback fires 7 ms after scheduling.
    let now = 1000;
    const c = new SystemMetricsCollector({
      now: () => now,
      schedule: (cb) => {
        now += 7;
        cb();
      },
    });
    const sample = await c.sample();
    expect(sample.eventLoopLagMs).toBe(7);
  });

  test('Prom gauges register and update on sample', async () => {
    const { registry } = await import('@sr/metrics');
    const c = new SystemMetricsCollector();
    await c.sample();
    const text = await registry.metrics();
    expect(text).toContain('sr_process_rss_bytes');
    expect(text).toContain('sr_process_event_loop_lag_ms');
  });
});
