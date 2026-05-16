import { beforeEach, describe, expect, test } from 'bun:test';
import { IssueAlertEvaluator } from '../src/issue-alerts';
import type { AlertableEvent, IssueAlertRule } from '../src/types';

function rule(overrides: Partial<IssueAlertRule> = {}): IssueAlertRule {
  return {
    id: 'r1',
    projectId: '1',
    name: 'errors-above-warning',
    enabled: true,
    conditions: [{ kind: 'level-at-or-above', level: 'error' }],
    combinator: 'all',
    actions: [{ channel: 'slack', target: '#oncall' }],
    ...overrides,
  };
}

function event(overrides: Partial<AlertableEvent> = {}): AlertableEvent {
  return {
    projectId: '1',
    level: 'error',
    timestamp: 1_000,
    ...overrides,
  };
}

describe('IssueAlertEvaluator', () => {
  let ev: IssueAlertEvaluator;
  beforeEach(() => {
    ev = new IssueAlertEvaluator();
  });

  test('fires when conditions match', () => {
    ev.addRule(rule());
    const fires = ev.evaluate(event());
    expect(fires.length).toBe(1);
    expect(fires[0]?.ruleId).toBe('r1');
  });

  test('does not fire when level too low', () => {
    ev.addRule(rule());
    expect(ev.evaluate(event({ level: 'info' })).length).toBe(0);
  });

  test('disabled rules do not fire', () => {
    ev.addRule(rule({ enabled: false }));
    expect(ev.evaluate(event()).length).toBe(0);
  });

  test('respects project isolation', () => {
    ev.addRule(rule({ projectId: '99' }));
    expect(ev.evaluate(event({ projectId: '1' })).length).toBe(0);
  });

  test('combinator=all requires every condition', () => {
    ev.addRule(
      rule({
        conditions: [
          { kind: 'level-at-or-above', level: 'error' },
          { kind: 'environment-equals', environment: 'prod' },
        ],
      }),
    );
    expect(ev.evaluate(event({ environment: 'prod' })).length).toBe(1);
    expect(ev.evaluate(event({ environment: 'dev' })).length).toBe(0);
  });

  test('combinator=any matches if any condition matches', () => {
    ev.addRule(
      rule({
        combinator: 'any',
        conditions: [{ kind: 'is-unhandled' }, { kind: 'level-at-or-above', level: 'fatal' }],
      }),
    );
    expect(ev.evaluate(event({ isUnhandled: true, level: 'warning' })).length).toBe(1);
    expect(ev.evaluate(event({ isUnhandled: false, level: 'fatal' })).length).toBe(1);
    expect(ev.evaluate(event({ isUnhandled: false, level: 'warning' })).length).toBe(0);
  });

  test('tag-equals matches', () => {
    ev.addRule(rule({ conditions: [{ kind: 'tag-equals', key: 'region', value: 'eu-west' }] }));
    expect(ev.evaluate(event({ tags: { region: 'eu-west' } })).length).toBe(1);
    expect(ev.evaluate(event({ tags: { region: 'us-east' } })).length).toBe(0);
    expect(ev.evaluate(event({})).length).toBe(0);
  });

  test('frequency-events-per-minute', () => {
    ev.addRule(rule({ conditions: [{ kind: 'frequency-events-per-minute', threshold: 100 }] }));
    expect(ev.evaluate(event({ currentEpm: 50 })).length).toBe(0);
    expect(ev.evaluate(event({ currentEpm: 100, timestamp: 2_000 })).length).toBe(1);
    expect(ev.evaluate(event({ currentEpm: 250, timestamp: 3_000 })).length).toBe(1);
  });

  test('is-new fires only on the first event for a group', () => {
    ev.addRule(rule({ conditions: [{ kind: 'is-new' }] }));
    expect(ev.evaluate(event({ isNew: true })).length).toBe(1);
    expect(ev.evaluate(event({ isNew: false, timestamp: 2_000 })).length).toBe(0);
  });

  test('cooldown suppresses repeated fires', () => {
    ev.addRule(rule({ cooldownMs: 60_000 }));
    expect(ev.evaluate(event({ timestamp: 1_000 })).length).toBe(1);
    expect(ev.evaluate(event({ timestamp: 30_000 })).length).toBe(0);
    expect(ev.evaluate(event({ timestamp: 65_000 })).length).toBe(1);
  });

  test('no conditions = always matches', () => {
    ev.addRule(rule({ conditions: [] }));
    expect(ev.evaluate(event({ level: 'debug' })).length).toBe(1);
  });

  test('removeRule clears state', () => {
    ev.addRule(rule());
    ev.removeRule('r1');
    expect(ev.rule('r1')).toBeUndefined();
    expect(ev.evaluate(event()).length).toBe(0);
  });
});
