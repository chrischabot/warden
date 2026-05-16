import { gauge } from '@sr/metrics';
import type { SystemMetricsSample } from './types';

type SrGauge = ReturnType<typeof gauge>;

interface NodeProcess {
  memoryUsage(): {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpuUsage(prev?: { user: number; system: number }): { user: number; system: number };
  uptime(): number;
}

export interface SystemMetricsOptions {
  /** Snapshot every N ms. Default 5000. */
  readonly sampleIntervalMs?: number;
  /** Hook called for each sample (e.g. push to a metrics registry). */
  readonly onSample?: (sample: SystemMetricsSample) => void;
  /**
   * When true (default), the collector registers + updates a fixed
   * set of `sr_process_*` gauges on the shared @sr/metrics registry.
   * Set false in tests / when multiple collectors share a process.
   */
  readonly registerPromGauges?: boolean;
  /** Clock for tests. */
  readonly now?: () => number;
  /** setImmediate provider for tests. */
  readonly schedule?: (cb: () => void) => void;
}

interface PromGauges {
  readonly rss: SrGauge;
  readonly heapUsed: SrGauge;
  readonly heapTotal: SrGauge;
  readonly external: SrGauge;
  readonly cpuUser: SrGauge;
  readonly cpuSystem: SrGauge;
  readonly lag: SrGauge;
  readonly uptime: SrGauge;
}

let SHARED_GAUGES: PromGauges | undefined;

function ensureGauges(): PromGauges {
  if (SHARED_GAUGES) return SHARED_GAUGES;
  SHARED_GAUGES = {
    rss: gauge({ name: 'process_rss_bytes', help: 'Resident set size in bytes.' }),
    heapUsed: gauge({ name: 'process_heap_used_bytes', help: 'JS heap currently in use.' }),
    heapTotal: gauge({ name: 'process_heap_total_bytes', help: 'JS heap allocated.' }),
    external: gauge({
      name: 'process_external_bytes',
      help: 'V8/JSC external memory (typed arrays, buffers).',
    }),
    cpuUser: gauge({
      name: 'process_cpu_user_us_delta',
      help: 'User-mode CPU time consumed since the previous sample, in microseconds.',
    }),
    cpuSystem: gauge({
      name: 'process_cpu_system_us_delta',
      help: 'Kernel-mode CPU time consumed since the previous sample, in microseconds.',
    }),
    lag: gauge({
      name: 'process_event_loop_lag_ms',
      help: 'Last event-loop lag measurement in ms.',
    }),
    uptime: gauge({ name: 'process_uptime_seconds', help: 'Process uptime in seconds.' }),
  };
  return SHARED_GAUGES;
}

export class SystemMetricsCollector {
  private readonly intervalMs: number;
  private readonly onSample: ((sample: SystemMetricsSample) => void) | undefined;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void) => void;
  private readonly gauges: PromGauges | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private prevCpu = { user: 0, system: 0 };

  constructor(options: SystemMetricsOptions = {}) {
    this.intervalMs = options.sampleIntervalMs ?? 5000;
    this.onSample = options.onSample;
    this.now = options.now ?? (() => Date.now());
    this.schedule =
      options.schedule ??
      ((cb: () => void) => {
        if (typeof setImmediate === 'function') setImmediate(cb);
        else setTimeout(cb, 0);
      });
    this.gauges = options.registerPromGauges === false ? undefined : ensureGauges();
  }

  /** Start periodic sampling. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      // Awaiting the promise would block the interval; ignore.
      void this.sample();
    }, this.intervalMs);
  }

  /** Stop periodic sampling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Take a single sample on demand.
   *
   * NOTE on CPU semantics: `cpuUserUs` and `cpuSystemUs` are
   * DELTAS — microseconds consumed since the previous `sample()`
   * call on the same collector instance, not cumulative-since-start.
   * The first sample's delta is measured against zero.
   */
  async sample(): Promise<SystemMetricsSample> {
    const proc = (globalThis as { process?: NodeProcess }).process;
    const memory = proc?.memoryUsage() ?? defaultMemory();
    const cpu = proc?.cpuUsage(this.prevCpu) ?? { user: 0, system: 0 };
    this.prevCpu = proc?.cpuUsage() ?? this.prevCpu;
    const uptime = proc?.uptime() ?? 0;
    const eventLoopLagMs = await this.measureLag();
    const sample: SystemMetricsSample = {
      capturedAt: this.now(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      cpuUserUs: cpu.user,
      cpuSystemUs: cpu.system,
      eventLoopLagMs,
      uptimeSec: uptime,
    };
    if (this.gauges) {
      this.gauges.rss.set(sample.rssBytes);
      this.gauges.heapUsed.set(sample.heapUsedBytes);
      this.gauges.heapTotal.set(sample.heapTotalBytes);
      this.gauges.external.set(sample.externalBytes);
      this.gauges.cpuUser.set(sample.cpuUserUs);
      this.gauges.cpuSystem.set(sample.cpuSystemUs);
      this.gauges.lag.set(sample.eventLoopLagMs);
      this.gauges.uptime.set(sample.uptimeSec);
    }
    if (this.onSample) this.onSample(sample);
    return sample;
  }

  private measureLag(): Promise<number> {
    return new Promise<number>((resolve) => {
      const start = this.now();
      this.schedule(() => {
        resolve(Math.max(0, this.now() - start));
      });
    });
  }
}

function defaultMemory(): {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
} {
  return { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 };
}
