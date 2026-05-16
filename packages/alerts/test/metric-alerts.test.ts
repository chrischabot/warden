import { beforeEach, describe, expect, test } from 'bun:test';
import { MetricAlertEvaluator } from '../src/metric-alerts';
import type { MetricAlertRule } from '../src/types';

function rule(overrides: Partial<MetricAlertRule> = {}): MetricAlertRule {
  return {
    id: 'r1',
    projectId: '1',
    name: 'rate',
    enabled: true,
    lookbackWindowMs: 60_000,
    criticalThreshold: 100,
    warningThreshold: 50,
    resolveThreshold: 40,
    comparison: '>',
    actions: [{ channel: 'slack', target: '#oncall' }],
    ...overrides,
  };
}

describe('MetricAlertEvaluator — state machine', () => {
  let e: MetricAlertEvaluator;
  beforeEach(() => {
    e = new MetricAlertEvaluator();
    e.addRule(rule());
  });

  test('starts in ok', () => {
    expect(e.state('r1')?.status).toBe('ok');
  });

  test('ok → warning when crossing warning threshold', () => {
    const t = e.evaluate('r1', 60, 1000);
    expect(t?.current).toBe('warning');
    expect(t?.previous).toBe('ok');
  });

  test('warning → critical when crossing critical threshold', () => {
    e.evaluate('r1', 60, 1000);
    const t = e.evaluate('r1', 200, 2000);
    expect(t?.current).toBe('critical');
  });

  test('critical stays critical until value drops to resolveThreshold', () => {
    e.evaluate('r1', 200, 1000); // critical
    expect(e.evaluate('r1', 150, 2000)).toBeUndefined(); // still critical
    const t = e.evaluate('r1', 30, 3000); // back to ok (≤ resolve threshold 40)
    expect(t?.current).toBe('ok');
    expect(t?.previous).toBe('critical');
  });

  test('critical → warning when value drops between resolve and critical', () => {
    e.evaluate('r1', 200, 1000); // critical
    const t = e.evaluate('r1', 80, 2000); // critical=100, warning=50; 80 trips warning
    expect(t?.current).toBe('warning');
  });

  test('warning → ok when at-or-below resolveThreshold', () => {
    e.evaluate('r1', 60, 1000);
    const t = e.evaluate('r1', 40, 2000);
    expect(t?.current).toBe('ok');
  });

  test('no transition returns undefined', () => {
    e.evaluate('r1', 60, 1000); // warning
    expect(e.evaluate('r1', 55, 2000)).toBeUndefined(); // still warning
  });

  test('triggerCount counts only ok→warning and ok/warning→critical', () => {
    e.evaluate('r1', 60, 1000); // ok → warning, +1
    e.evaluate('r1', 200, 2000); // warning → critical, +1
    e.evaluate('r1', 30, 3000); // critical → ok, no counter
    e.evaluate('r1', 60, 4000); // ok → warning, +1
    expect(e.state('r1')?.triggerCount).toBe(3);
  });

  test('disabled rule never transitions', () => {
    e.removeRule('r1');
    e.addRule(rule({ enabled: false }));
    expect(e.evaluate('r1', 1_000, 1000)).toBeUndefined();
    expect(e.state('r1')?.status).toBe('ok');
  });
});

describe('MetricAlertEvaluator — comparison=<', () => {
  let e: MetricAlertEvaluator;
  beforeEach(() => {
    e = new MetricAlertEvaluator();
    e.addRule(
      rule({
        comparison: '<',
        criticalThreshold: 10,
        warningThreshold: 50,
        resolveThreshold: 60,
      }),
    );
  });

  test('ok → warning when value falls below warning threshold', () => {
    const t = e.evaluate('r1', 40, 1000);
    expect(t?.current).toBe('warning');
  });

  test('warning → critical when value falls below critical', () => {
    e.evaluate('r1', 40, 1000); // warning
    const t = e.evaluate('r1', 5, 2000); // critical
    expect(t?.current).toBe('critical');
  });

  test('returns to ok when at-or-above resolveThreshold', () => {
    e.evaluate('r1', 5, 1000); // critical
    const t = e.evaluate('r1', 70, 2000); // ok
    expect(t?.current).toBe('ok');
  });
});

describe('MetricAlertEvaluator — validation', () => {
  test('rejects warning ≥ critical for > comparison', () => {
    const e = new MetricAlertEvaluator();
    expect(() =>
      e.addRule(rule({ comparison: '>', warningThreshold: 200, criticalThreshold: 100 })),
    ).toThrow(RangeError);
  });

  test('rejects warning ≤ critical for < comparison', () => {
    const e = new MetricAlertEvaluator();
    expect(() =>
      e.addRule(
        rule({ comparison: '<', warningThreshold: 5, criticalThreshold: 10, resolveThreshold: 20 }),
      ),
    ).toThrow(RangeError);
  });

  test('evaluating unknown rule throws', () => {
    const e = new MetricAlertEvaluator();
    expect(() => e.evaluate('nope', 1, 0)).toThrow(RangeError);
  });
});
