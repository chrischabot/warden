/**
 * Probe classifier.
 *
 * Given an HTTP response (or a probe failure), determine the
 * status per the check's successCriteria.
 *
 * This module deliberately doesn't make HTTP requests itself —
 * the scheduler in `apps/uptime` injects a `Probe` function so we
 * can test classification logic against synthetic responses and
 * keep the package free of fetch / URL plumbing.
 */

import type { CheckResult, CheckStatus, SuccessCriteria, UptimeCheck } from './types';

const DEFAULT_STATUS_MIN = 200;
const DEFAULT_STATUS_MAX = 299;
const DEFAULT_DEGRADED_MS = 5000;
const DEFAULT_DOWN_MS = 10000;

export interface ProbeOutcome {
  readonly httpStatus?: number;
  readonly responseTimeMs: number;
  readonly bodySample?: string;
  readonly errorMessage?: string;
}

/** Pure classifier — no I/O. */
export function classify(
  outcome: ProbeOutcome,
  criteria: SuccessCriteria,
): { readonly status: CheckStatus; readonly failureReason?: string } {
  const statusMin = criteria.statusMin ?? DEFAULT_STATUS_MIN;
  const statusMax = criteria.statusMax ?? DEFAULT_STATUS_MAX;
  const degradedThreshold = criteria.degradedThresholdMs ?? DEFAULT_DEGRADED_MS;
  const downThreshold = criteria.downThresholdMs ?? DEFAULT_DOWN_MS;

  if (outcome.errorMessage) {
    return { status: 'down', failureReason: outcome.errorMessage };
  }
  if (typeof outcome.httpStatus !== 'number') {
    return { status: 'down', failureReason: 'no HTTP status returned' };
  }
  if (outcome.httpStatus < statusMin || outcome.httpStatus > statusMax) {
    return {
      status: 'down',
      failureReason: `HTTP ${outcome.httpStatus} outside [${statusMin}, ${statusMax}]`,
    };
  }
  if (outcome.responseTimeMs >= downThreshold) {
    return {
      status: 'down',
      failureReason: `response_time ${outcome.responseTimeMs}ms ≥ ${downThreshold}ms`,
    };
  }
  if (criteria.bodyContains && !(outcome.bodySample ?? '').includes(criteria.bodyContains)) {
    return {
      status: 'down',
      failureReason: `body does not contain "${criteria.bodyContains}"`,
    };
  }
  if (outcome.responseTimeMs >= degradedThreshold) {
    return { status: 'degraded' };
  }
  return { status: 'up' };
}

/** Composed: build a full CheckResult given a probe outcome. */
export function resultFor(
  check: UptimeCheck,
  outcome: ProbeOutcome,
  observedAt: number,
  id: string,
): CheckResult {
  const { status, failureReason } = classify(outcome, check.successCriteria);
  const out: CheckResult = {
    id,
    checkId: check.id,
    status,
    ...(typeof outcome.httpStatus === 'number' ? { httpStatus: outcome.httpStatus } : {}),
    responseTimeMs: outcome.responseTimeMs,
    observedAt,
    ...(failureReason ? { failureReason } : {}),
  };
  return out;
}
