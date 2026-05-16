/**
 * Health-check registry.
 *
 * The aggregate status is determined by the worst child status:
 * `fail` wins over `warn`, which wins over `pass`. Health checks
 * have a per-check timeout (default 5s); when a check exceeds it,
 * the registry records it as `fail` with a timeout message.
 *
 * Checks are run concurrently. The `run()` result is deterministic
 * in the order checks were registered.
 */

import type {
  AggregateHealth,
  HealthCheck,
  HealthCheckFn,
  HealthCheckResult,
  HealthStatus,
} from './types';

const STATUS_RANK: Readonly<Record<HealthStatus, number>> = Object.freeze({
  pass: 0,
  warn: 1,
  fail: 2,
});

export interface HealthRegistryOptions {
  /** Per-check timeout in ms. Default 5000. */
  readonly checkTimeoutMs?: number;
  /** Clock for tests. */
  readonly now?: () => number;
}

export class HealthCheckRegistry {
  private readonly checks: HealthCheck[] = [];
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: HealthRegistryOptions = {}) {
    this.timeoutMs = options.checkTimeoutMs ?? 5000;
    this.now = options.now ?? (() => Date.now());
  }

  register(subsystem: string, name: string, fn: HealthCheckFn): void {
    if (this.checks.some((c) => c.subsystem === subsystem && c.name === name)) {
      throw new RangeError(`HealthCheckRegistry: check "${subsystem}/${name}" already registered`);
    }
    this.checks.push({ subsystem, name, fn });
  }

  unregister(subsystem: string, name: string): void {
    const idx = this.checks.findIndex((c) => c.subsystem === subsystem && c.name === name);
    if (idx >= 0) this.checks.splice(idx, 1);
  }

  /** Registered checks (test diagnostics). */
  list(): readonly HealthCheck[] {
    return Object.freeze([...this.checks]);
  }

  /** Run every check concurrently, with per-check timeout. */
  async run(): Promise<AggregateHealth> {
    const checkedAt = this.now();
    const results = await Promise.all(this.checks.map((c) => this.runOne(c)));
    let worst: HealthStatus = 'pass';
    for (const r of results) {
      if (STATUS_RANK[r.status] > STATUS_RANK[worst]) worst = r.status;
    }
    return Object.freeze({
      status: worst,
      results: Object.freeze(results),
      checkedAt,
    });
  }

  /** Run a single check by name. Returns undefined if not registered. */
  async runOne(check: HealthCheck): Promise<HealthCheckResult> {
    const start = this.now();
    const checkedAt = start;
    try {
      const promise = Promise.resolve().then(() => check.fn());
      const value = await withTimeout(promise, this.timeoutMs);
      const durationMs = this.now() - start;
      return Object.freeze({
        ...value,
        name: check.name,
        subsystem: check.subsystem,
        durationMs,
        checkedAt,
      });
    } catch (e) {
      const durationMs = this.now() - start;
      const isTimeout = (e as Error).message === '__timeout__';
      return Object.freeze({
        status: 'fail' as HealthStatus,
        message: isTimeout
          ? `health check timed out after ${this.timeoutMs}ms`
          : `health check threw: ${(e as Error).message}`,
        name: check.name,
        subsystem: check.subsystem,
        durationMs,
        checkedAt,
      });
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('__timeout__')), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
