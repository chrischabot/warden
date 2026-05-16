import { describe, expect, test } from 'bun:test';
import { Sampler } from '../src/sampler';
import type { SamplingRule } from '../src/types';

describe('Sampler — rule matching', () => {
  test('exact-value match wins', () => {
    const rules: SamplingRule[] = [
      {
        id: 'prod-js',
        conditions: { platform: 'javascript', environment: 'production' },
        sampleRate: 0,
      },
    ];
    const sampler = new Sampler(rules, { defaultSampleRate: 1 });
    expect(
      sampler.decide({
        trace_id: 'x'.repeat(32),
        platform: 'javascript',
        environment: 'production',
      }).decision,
    ).toBe('drop');
  });

  test('any-of values match', () => {
    const rules: SamplingRule[] = [
      {
        id: 'web-stack',
        conditions: { platform: ['javascript', 'typescript'] },
        sampleRate: 0,
      },
    ];
    const sampler = new Sampler(rules, { defaultSampleRate: 1 });
    expect(sampler.decide({ trace_id: 't', platform: 'javascript' }).decision).toBe('drop');
    expect(sampler.decide({ trace_id: 't', platform: 'typescript' }).decision).toBe('drop');
    expect(sampler.decide({ trace_id: 't', platform: 'python' }).decision).toBe('keep');
  });

  test('event missing required field fails the rule', () => {
    const rules: SamplingRule[] = [
      { id: 'env-prod', conditions: { environment: 'production' }, sampleRate: 0 },
    ];
    const sampler = new Sampler(rules, { defaultSampleRate: 1 });
    expect(sampler.decide({ trace_id: 't' }).decision).toBe('keep'); // no environment → default
  });

  test('wildcard rule with no conditions always matches', () => {
    const rules: SamplingRule[] = [{ id: 'catchall', conditions: {}, sampleRate: 0 }];
    const sampler = new Sampler(rules);
    expect(sampler.decide({ trace_id: 't' }).decision).toBe('drop');
    expect(sampler.decide({}).decision).toBe('drop');
  });

  test('first-match-wins', () => {
    const rules: SamplingRule[] = [
      { id: 'a', conditions: { platform: 'python' }, sampleRate: 1 },
      { id: 'b', conditions: { platform: ['python', 'go'] }, sampleRate: 0 },
    ];
    const sampler = new Sampler(rules);
    const r = sampler.decide({ trace_id: 't', platform: 'python' });
    expect(r.decision).toBe('keep');
    expect(r.matchedRuleId).toBe('a');
  });

  test('no rule matches → default rate applied', () => {
    const sampler = new Sampler([], { defaultSampleRate: 0 });
    expect(sampler.decide({ trace_id: 't' }).decision).toBe('drop');
    expect(sampler.decide({ trace_id: 't' }).matchedRuleId).toBeUndefined();
  });
});

describe('Sampler — determinism on trace_id', () => {
  test('same trace_id with rate 0.5 always produces the same decision', () => {
    const sampler = new Sampler([], { defaultSampleRate: 0.5 });
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const r1 = sampler.decide({ trace_id: traceId });
    for (let i = 0; i < 100; i++) {
      expect(sampler.decide({ trace_id: traceId }).decision).toBe(r1.decision);
    }
  });

  test('different trace_ids can produce different decisions', () => {
    const sampler = new Sampler([], { defaultSampleRate: 0.5 });
    const decisions = new Set<string>();
    for (let i = 0; i < 100; i++) {
      decisions.add(sampler.decide({ trace_id: `trace-${i}` }).decision);
    }
    // Over 100 distinct trace ids at p=0.5, we expect both keep and drop.
    expect(decisions.has('keep')).toBe(true);
    expect(decisions.has('drop')).toBe(true);
  });

  test('decision is deterministic even without trace_id (via field signature)', () => {
    const sampler = new Sampler([], { defaultSampleRate: 0.5 });
    const event = { platform: 'javascript', environment: 'production' };
    const first = sampler.decide(event).decision;
    for (let i = 0; i < 50; i++) {
      expect(sampler.decide(event).decision).toBe(first);
    }
  });
});

describe('Sampler — edge rates', () => {
  test('rate 0 always drops', () => {
    const sampler = new Sampler([], { defaultSampleRate: 0 });
    for (let i = 0; i < 50; i++) {
      expect(sampler.decide({ trace_id: `t-${i}` }).decision).toBe('drop');
    }
  });

  test('rate 1 always keeps', () => {
    const sampler = new Sampler([], { defaultSampleRate: 1 });
    for (let i = 0; i < 50; i++) {
      expect(sampler.decide({ trace_id: `t-${i}` }).decision).toBe('keep');
    }
  });

  test('rate out-of-range is rejected', () => {
    expect(() => new Sampler([{ id: 'x', conditions: {}, sampleRate: 1.5 }])).toThrow(RangeError);
    expect(() => new Sampler([], { defaultSampleRate: -0.1 })).toThrow(RangeError);
  });
});

describe('Sampler — statistical fairness', () => {
  test('rate 0.3 over many distinct traces produces approximately 30% keeps', () => {
    const sampler = new Sampler([], { defaultSampleRate: 0.3 });
    const n = 10_000;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      if (sampler.decide({ trace_id: `t-${i}` }).decision === 'keep') kept++;
    }
    const observed = kept / n;
    // Allow a wide tolerance for hash-distribution variance over 10k samples.
    expect(observed).toBeGreaterThan(0.27);
    expect(observed).toBeLessThan(0.33);
  });

  test('decision shape includes matched rate and id', () => {
    const sampler = new Sampler([{ id: 'r1', conditions: { platform: 'rust' }, sampleRate: 0.5 }]);
    const r = sampler.decide({ trace_id: 't', platform: 'rust' });
    expect(r.rate).toBe(0.5);
    expect(r.matchedRuleId).toBe('r1');
    expect(Object.isFrozen(r)).toBe(true);
  });
});
