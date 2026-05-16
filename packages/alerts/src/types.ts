/**
 * Alert types.
 *
 * Two alert flavours per spec §5.8:
 *
 *   Issue alerts — fire on a per-event basis when conditions
 *     (level, environment, release, frequency) match. Result is
 *     one or more notifications to configured channels.
 *
 *   Metric alerts — evaluate an aggregate over a rolling window
 *     (count, p95, failure_rate, …). Cross above `criticalThreshold`
 *     for `lookbackWindowMs` → critical. Cross above `warningThreshold`
 *     → warning. Cross back below `resolveThreshold` (defaults to
 *     `warningThreshold` if set, else `criticalThreshold`) → resolved.
 *     Hysteresis prevents flapping.
 */

import type { SentryLevel } from './sentry-level';

export type AlertChannel = 'email' | 'slack' | 'webhook' | 'pagerduty' | 'opsgenie';

export interface NotificationAction {
  readonly channel: AlertChannel;
  readonly target: string; // email address, slack channel, webhook url, etc.
}

// ---- Issue alerts ----

export type IssueAlertCondition =
  | { kind: 'level-at-or-above'; level: SentryLevel }
  | { kind: 'environment-equals'; environment: string }
  | { kind: 'release-equals'; release: string }
  | { kind: 'tag-equals'; key: string; value: string }
  | { kind: 'frequency-events-per-minute'; threshold: number }
  | { kind: 'is-unhandled' }
  | { kind: 'is-new' };

export type IssueAlertCombinator = 'all' | 'any';

export interface IssueAlertRule {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly conditions: readonly IssueAlertCondition[];
  readonly combinator: IssueAlertCombinator;
  readonly actions: readonly NotificationAction[];
  /** Minimum interval between two notifications from this rule. */
  readonly cooldownMs?: number;
}

/** Lightweight event projection consumed by the issue-alert evaluator. */
export interface AlertableEvent {
  readonly projectId: string;
  readonly level: SentryLevel;
  readonly environment?: string;
  readonly release?: string;
  readonly tags?: Record<string, string>;
  readonly timestamp: number;
  readonly isUnhandled?: boolean;
  readonly isNew?: boolean;
  /** Events-per-minute observed for this event's group at evaluation time. */
  readonly currentEpm?: number;
}

export interface IssueAlertFire {
  readonly ruleId: string;
  readonly firedAt: number;
  readonly actions: readonly NotificationAction[];
}

// ---- Metric alerts ----

export type MetricAlertStatus = 'ok' | 'warning' | 'critical';

export interface MetricAlertRule {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly enabled: boolean;
  /** Rolling window length in ms over which the aggregate is computed. */
  readonly lookbackWindowMs: number;
  readonly criticalThreshold: number;
  /** Optional warning threshold; must be lower than `criticalThreshold` when both fire on > comparisons. */
  readonly warningThreshold?: number;
  /** Threshold at or below which the alert resolves. Defaults to `warningThreshold ?? criticalThreshold`. */
  readonly resolveThreshold?: number;
  /** Comparison direction: '>' fires when the aggregate exceeds threshold; '<' fires when below. */
  readonly comparison: '>' | '<';
  readonly actions: readonly NotificationAction[];
}

export interface MetricAlertState {
  readonly ruleId: string;
  status: MetricAlertStatus;
  lastStatusChangeAt: number;
  lastValue: number;
  /** Number of warning/critical transitions observed across time. */
  triggerCount: number;
}

export interface MetricAlertTransition {
  readonly ruleId: string;
  readonly previous: MetricAlertStatus;
  readonly current: MetricAlertStatus;
  readonly value: number;
  readonly at: number;
}
