/**
 * Issue alert evaluator.
 *
 * For each rule registered with `addRule`, every event passed
 * through `evaluate` is checked. When the rule's conditions match
 * (combined under the rule's `combinator`) and the rule is not in
 * cooldown, a `IssueAlertFire` is emitted.
 *
 * Cooldown is per-rule: subsequent matches within `cooldownMs`
 * suppress further fires.
 */

import { LEVEL_RANK } from './sentry-level';
import type { AlertableEvent, IssueAlertCondition, IssueAlertFire, IssueAlertRule } from './types';

export class IssueAlertEvaluator {
  private readonly rules = new Map<string, IssueAlertRule>();
  private readonly lastFiredAt = new Map<string, number>();

  addRule(rule: IssueAlertRule): void {
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    this.lastFiredAt.delete(ruleId);
  }

  rule(ruleId: string): IssueAlertRule | undefined {
    return this.rules.get(ruleId);
  }

  evaluate(event: AlertableEvent): IssueAlertFire[] {
    const out: IssueAlertFire[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (rule.projectId !== event.projectId) continue;
      const matched = matchesAll(rule, event);
      if (!matched) continue;
      const last = this.lastFiredAt.get(rule.id);
      if (
        last !== undefined &&
        rule.cooldownMs !== undefined &&
        event.timestamp - last < rule.cooldownMs
      ) {
        continue;
      }
      this.lastFiredAt.set(rule.id, event.timestamp);
      out.push(
        Object.freeze({
          ruleId: rule.id,
          firedAt: event.timestamp,
          actions: rule.actions,
        }),
      );
    }
    return out;
  }
}

function matchesAll(rule: IssueAlertRule, event: AlertableEvent): boolean {
  if (rule.conditions.length === 0) return true;
  const results = rule.conditions.map((c) => matchesCondition(c, event));
  return rule.combinator === 'all' ? results.every((r) => r) : results.some((r) => r);
}

function matchesCondition(c: IssueAlertCondition, event: AlertableEvent): boolean {
  switch (c.kind) {
    case 'level-at-or-above':
      return LEVEL_RANK[event.level] >= LEVEL_RANK[c.level];
    case 'environment-equals':
      return event.environment === c.environment;
    case 'release-equals':
      return event.release === c.release;
    case 'tag-equals':
      return event.tags ? event.tags[c.key] === c.value : false;
    case 'frequency-events-per-minute':
      return typeof event.currentEpm === 'number' && event.currentEpm >= c.threshold;
    case 'is-unhandled':
      return event.isUnhandled === true;
    case 'is-new':
      return event.isNew === true;
    default:
      return false;
  }
}
