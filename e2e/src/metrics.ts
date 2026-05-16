/**
 * Lightweight perf recorder.
 *
 * Samples event-loop lag every `sampleIntervalMs` (default 10ms) by
 * comparing setTimeout dispatch wall-clock to scheduled time. Memory
 * snapshots taken before `start()` and after `stop()`.
 */

interface Snapshot {
  readonly rss: number;
  readonly heapUsed: number;
  readonly heapTotal: number;
}

export interface PerfReport {
  readonly wallMs: number;
  readonly events: number;
  readonly throughputPerSec: number;
  readonly memory: {
    readonly rssDeltaBytes: number;
    readonly heapDeltaBytes: number;
    readonly rssBeforeBytes: number;
    readonly rssAfterBytes: number;
    readonly heapBeforeBytes: number;
    readonly heapAfterBytes: number;
  };
  readonly lagMs: {
    readonly count: number;
    readonly min: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
    readonly mean: number;
  };
}

export class PerfRecorder {
  private readonly lags: number[] = [];
  private startedAt = 0;
  private endedAt = 0;
  private before?: Snapshot;
  private after?: Snapshot;
  private sampling = false;
  private readonly intervalMs: number;
  private events = 0;

  constructor(opts: { readonly sampleIntervalMs?: number } = {}) {
    this.intervalMs = opts.sampleIntervalMs ?? 10;
  }

  start(): void {
    this.before = snapshot();
    this.startedAt = performance.now();
    this.sampling = true;
    this.scheduleSample();
  }

  count(events = 1): void {
    this.events += events;
  }

  async stop(): Promise<PerfReport> {
    this.endedAt = performance.now();
    this.sampling = false;
    this.after = snapshot();
    return this.report();
  }

  private scheduleSample(): void {
    if (!this.sampling) return;
    const scheduledAt = performance.now();
    setTimeout(() => {
      if (!this.sampling) return;
      const actual = performance.now();
      const lag = Math.max(0, actual - scheduledAt - this.intervalMs);
      this.lags.push(lag);
      this.scheduleSample();
    }, this.intervalMs);
  }

  private report(): PerfReport {
    const wallMs = this.endedAt - this.startedAt;
    const lagStats = quantiles(this.lags);
    const mem = {
      rssDeltaBytes: (this.after?.rss ?? 0) - (this.before?.rss ?? 0),
      heapDeltaBytes: (this.after?.heapUsed ?? 0) - (this.before?.heapUsed ?? 0),
      rssBeforeBytes: this.before?.rss ?? 0,
      rssAfterBytes: this.after?.rss ?? 0,
      heapBeforeBytes: this.before?.heapUsed ?? 0,
      heapAfterBytes: this.after?.heapUsed ?? 0,
    };
    return Object.freeze({
      wallMs,
      events: this.events,
      throughputPerSec: wallMs > 0 ? (this.events * 1000) / wallMs : 0,
      memory: mem,
      lagMs: lagStats,
    });
  }
}

export function formatReport(label: string, r: PerfReport): string {
  const lines: string[] = [];
  const bar = '='.repeat(60);
  lines.push(`=== ${label} ${'='.repeat(Math.max(0, 56 - label.length))}`);
  lines.push(`| Events:       ${r.events.toLocaleString()}`);
  lines.push(`| Wall time:    ${r.wallMs.toFixed(1)} ms`);
  lines.push(`| Throughput:   ${r.throughputPerSec.toFixed(0)} events/s`);
  lines.push(`|`);
  lines.push(`| Memory before  RSS: ${mib(r.memory.rssBeforeBytes)}  heap: ${mib(r.memory.heapBeforeBytes)}`);
  lines.push(`| Memory after   RSS: ${mib(r.memory.rssAfterBytes)}  heap: ${mib(r.memory.heapAfterBytes)}`);
  lines.push(`| Memory delta   RSS: ${mibSigned(r.memory.rssDeltaBytes)}  heap: ${mibSigned(r.memory.heapDeltaBytes)}`);
  lines.push(`|`);
  lines.push(`| Event-loop lag (ms) - count: ${r.lagMs.count}`);
  lines.push(
    `|   min ${r.lagMs.min.toFixed(2)}  p50 ${r.lagMs.p50.toFixed(2)}  p95 ${r.lagMs.p95.toFixed(2)}  p99 ${r.lagMs.p99.toFixed(2)}  max ${r.lagMs.max.toFixed(2)}  mean ${r.lagMs.mean.toFixed(2)}`,
  );
  lines.push(`${bar}`);
  return lines.join('\n');
}

function snapshot(): Snapshot {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
    return { rss: 0, heapUsed: 0, heapTotal: 0 };
  }
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal };
}

function quantiles(values: readonly number[]): PerfReport['lagMs'] {
  if (values.length === 0) {
    return Object.freeze({ count: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 });
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number): number => {
    if (sorted.length === 1) return sorted[0] as number;
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const frac = pos - lo;
    return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
  };
  let sum = 0;
  for (const v of sorted) sum += v;
  return Object.freeze({
    count: values.length,
    min: sorted[0] as number,
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[sorted.length - 1] as number,
    mean: sum / sorted.length,
  });
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function mibSigned(bytes: number): string {
  const sign = bytes >= 0 ? '+' : '';
  return `${sign}${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}