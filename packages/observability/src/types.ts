/**
 * Self-observability types per spec §9.
 *
 * `HealthStatus`:
 *   - 'pass'    — subsystem is fully operational
 *   - 'warn'    — subsystem is degraded but serving traffic
 *   - 'fail'    — subsystem is unhealthy; route around or alert
 *
 * `HealthCheck`:
 *   - synchronous or async function returning a HealthReport
 *   - typical name shapes: 'wal-fsync', 'columnar-shard-3',
 *     'queue-segment-roll', 'sqlite-shard-0', etc.
 */

export type HealthStatus = 'pass' | 'warn' | 'fail';

export interface HealthReport {
  readonly status: HealthStatus;
  readonly message?: string;
  /** Optional structured details, e.g. { lagMs: 12 }. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export type HealthCheckFn = () => HealthReport | Promise<HealthReport>;

export interface HealthCheck {
  readonly name: string;
  readonly subsystem: string;
  readonly fn: HealthCheckFn;
}

export interface HealthCheckResult extends HealthReport {
  readonly name: string;
  readonly subsystem: string;
  readonly durationMs: number;
  readonly checkedAt: number;
}

export interface AggregateHealth {
  readonly status: HealthStatus;
  readonly results: readonly HealthCheckResult[];
  readonly checkedAt: number;
}

export interface SystemMetricsSample {
  readonly capturedAt: number;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly externalBytes: number;
  readonly cpuUserUs: number;
  readonly cpuSystemUs: number;
  /** ms — measured by setImmediate vs nominal next-tick. */
  readonly eventLoopLagMs: number;
  readonly uptimeSec: number;
}
