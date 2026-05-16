/**
 * Heartbeat emitter.
 *
 * Emits a `Heartbeat` event every `intervalMs` containing the most
 * recent aggregated health, the latest system-metrics sample, and
 * a monotonically increasing sequence number.
 *
 * Production wires the heartbeat into the relay's outbound queue
 * so it lands in the columnar event store as a self-instrumented
 * "service heartbeat" event-type. For unit tests, callers register
 * an `onBeat` callback.
 */

import type { HealthCheckRegistry } from './health';
import type { SystemMetricsCollector } from './system-metrics';
import type { AggregateHealth, SystemMetricsSample } from './types';

export interface Heartbeat {
  readonly sequence: number;
  readonly emittedAt: number;
  readonly health: AggregateHealth;
  readonly system: SystemMetricsSample;
  readonly serviceName: string;
  readonly serviceVersion: string;
}

export interface HeartbeatEmitterOptions {
  readonly intervalMs?: number;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly health: HealthCheckRegistry;
  readonly system: SystemMetricsCollector;
  readonly onBeat: (beat: Heartbeat) => void;
  readonly now?: () => number;
}

export class HeartbeatEmitter {
  private timer: ReturnType<typeof setInterval> | undefined;
  private sequence = 0;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(public readonly options: HeartbeatEmitterOptions) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.emitOnce();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Force a single heartbeat now. Resolves with the emitted record. */
  async emitOnce(): Promise<Heartbeat> {
    this.sequence += 1;
    const [health, system] = await Promise.all([
      this.options.health.run(),
      this.options.system.sample(),
    ]);
    const beat: Heartbeat = {
      sequence: this.sequence,
      emittedAt: this.now(),
      health,
      system,
      serviceName: this.options.serviceName,
      serviceVersion: this.options.serviceVersion,
    };
    this.options.onBeat(beat);
    return beat;
  }
}
