/**
 * Uptime monitoring types per spec §5.7.
 *
 * An `UptimeCheck` declares a URL, an interval, a HTTP method, optional
 * headers, and a `successCriteria` (e.g. status 200..299, timeout
 * threshold, optional body regex).
 *
 * Each probe produces a `CheckResult` with status `up` | `down`
 * | `degraded`. Sustained `down` results open an `Incident`; the
 * incident closes on the next sustained `up` window.
 *
 * Status transitions require N consecutive failures to declare
 * `down` (default 3) and N consecutive successes to declare back
 * up (default 2). This eliminates single-blip false positives.
 */

export type CheckStatus = 'up' | 'down' | 'degraded';

export interface SuccessCriteria {
  /** Inclusive lower bound on response.status_code. Default 200. */
  readonly statusMin?: number;
  /** Inclusive upper bound. Default 299. */
  readonly statusMax?: number;
  /** Max response time in ms; >= this counts as `degraded`. Default 5000. */
  readonly degradedThresholdMs?: number;
  /** Max response time in ms before declaring `down`. Default 10000. */
  readonly downThresholdMs?: number;
  /** Optional substring the response body must contain. */
  readonly bodyContains?: string;
}

export interface UptimeCheck {
  readonly id: string;
  readonly projectId: string;
  readonly slug: string;
  readonly url: string;
  readonly method: 'GET' | 'HEAD' | 'POST' | 'PUT';
  readonly headers?: Readonly<Record<string, string>>;
  readonly intervalMs: number;
  enabled: boolean;
  readonly successCriteria: SuccessCriteria;
  /** Consecutive failures required to declare `down`. Default 3. */
  readonly failuresToDown?: number;
  /** Consecutive successes required to declare back `up`. Default 2. */
  readonly successesToUp?: number;
  status: CheckStatus | 'unknown';
  consecutiveFails: number;
  consecutiveSuccesses: number;
  lastResultAt?: number;
  currentIncidentId?: string;
}

export interface CheckResult {
  readonly id: string;
  readonly checkId: string;
  readonly status: CheckStatus;
  readonly httpStatus?: number;
  readonly responseTimeMs: number;
  readonly observedAt: number;
  readonly failureReason?: string;
}

export interface Incident {
  readonly id: string;
  readonly checkId: string;
  readonly startedAt: number;
  resolvedAt?: number;
  /** Number of failures captured in this incident so far. */
  failureCount: number;
}

export interface CreateUptimeCheckInput {
  readonly id?: string;
  readonly projectId: string;
  readonly slug: string;
  readonly url: string;
  readonly method?: UptimeCheck['method'];
  readonly headers?: Readonly<Record<string, string>>;
  readonly intervalMs: number;
  readonly enabled?: boolean;
  readonly successCriteria?: SuccessCriteria;
  readonly failuresToDown?: number;
  readonly successesToUp?: number;
}
