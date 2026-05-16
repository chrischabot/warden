/**
 * Metric alert evaluator.
 *
 * The caller computes an aggregate (count, p95, failure_rate, …)
 * over the rule's `lookbackWindowMs` window and feeds the scalar
 * `value` to `evaluate(ruleId, value, atTimestamp)`. The evaluator
 * runs the state machine:
 *
 *   ok        ↔ warning ↔ critical
 *
 * with hysteresis: once in critical, the alert only de-escalates
 * once `value` drops at-or-below the `resolveThreshold`. Same for
 * warning.
 *
 * For comparison='<' (e.g. "throughput below X"), the direction
 * inverts: "exceeds threshold" means "falls below".
 */

import type {
  MetricAlertRule,
  MetricAlertState,
  MetricAlertStatus,
  MetricAlertTransition,
} from './types';

export class MetricAlertEvaluator {
  private readonly rules = new Map<string, MetricAlertRule>();
  private readonly states = new Map<string, MetricAlertState>();

  addRule(rule: MetricAlertRule): void {
    if (rule.warningThreshold !== undefined) {
      if (rule.comparison === '>' && rule.warningThreshold >= rule.criticalThreshold) {
        throw new RangeError(
          `MetricAlertEvaluator: rule "${rule.id}" warningThreshold (${rule.warningThreshold}) must be < criticalThreshold (${rule.criticalThreshold}) for '>' comparison`,
        );
      }
      if (rule.comparison === '<' && rule.warningThreshold <= rule.criticalThreshold) {
        throw new RangeError(
          `MetricAlertEvaluator: rule "${rule.id}" warningThreshold (${rule.warningThreshold}) must be > criticalThreshold (${rule.criticalThreshold}) for '<' comparison`,
        );
      }
    }
    this.rules.set(rule.id, rule);
    if (!this.states.has(rule.id)) {
      this.states.set(rule.id, {
        ruleId: rule.id,
        status: 'ok',
        lastStatusChangeAt: 0,
        lastValue: NaN,
        triggerCount: 0,
      });
    }
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    this.states.delete(ruleId);
  }

  state(ruleId: string): MetricAlertState | undefined {
    const s = this.states.get(ruleId);
    return s ? { ...s } : undefined;
  }

  rule(ruleId: string): MetricAlertRule | undefined {
    return this.rules.get(ruleId);
  }

  evaluate(ruleId: string, value: number, at: number): MetricAlertTransition | undefined {
    const rule = this.rules.get(ruleId);
    const state = this.states.get(ruleId);
    if (!rule || !state) {
      throw new RangeError(`MetricAlertEvaluator: unknown rule "${ruleId}"`);
    }
    if (!rule.enabled) {
      state.lastValue = value;
      return undefined;
    }
    const desired = nextStatus(rule, state.status, value);
    state.lastValue = value;
    if (desired === state.status) return undefined;

    const previous = state.status;
    state.status = desired;
    state.lastStatusChangeAt = at;
    if (desired === 'critical' || desired === 'warning') {
      state.triggerCount += 1;
    }
    return Object.freeze({ ruleId, previous, current: desired, value, at });
  }
}

function nextStatus(
  rule: MetricAlertRule,
  current: MetricAlertStatus,
  value: number,
): MetricAlertStatus {
  const exceedsCritical = compare(value, rule.criticalThreshold, rule.comparison);
  const exceedsWarning =
    rule.warningThreshold !== undefined && compare(value, rule.warningThreshold, rule.comparison);
  const resolveAt = rule.resolveThreshold ?? rule.warningThreshold ?? rule.criticalThreshold;
  const isResolved = !compare(value, resolveAt, rule.comparison);

  // Always honour critical first.
  if (exceedsCritical) return 'critical';
  if (exceedsWarning) return 'warning';

  if (current === 'critical') {
    if (isResolved) return 'ok';
    // Still above resolveThreshold; hold at the highest active status
    // we know is still tripped. If only warning threshold exists and
    // is still tripped above resolve, sit at warning.
    if (
      rule.warningThreshold !== undefined &&
      compare(value, rule.warningThreshold, rule.comparison)
    ) {
      return 'warning';
    }
    return 'critical';
  }
  if (current === 'warning') {
    if (isResolved) return 'ok';
    return 'warning';
  }
  return 'ok';
}

function compare(value: number, threshold: number, op: '>' | '<'): boolean {
  return op === '>' ? value > threshold : value < threshold;
}
