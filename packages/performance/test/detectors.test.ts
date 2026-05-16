import { describe, expect, test } from 'bun:test';
import { detect, detectNPlusOne, detectSlowQueries } from '../src/detectors';
import type { Span } from '../src/types';

function span(overrides: Partial<Span> = {}): Span {
  return {
    traceId: 't1',
    spanId: 's' + Math.random().toString(36).slice(2, 8),
    parentSpanId: 'root',
    op: 'db',
    description: 'SELECT * FROM users WHERE id = ?',
    startTimestamp: 0,
    endTimestamp: 100,
    durationMs: 100,
    status: 'ok',
    ...overrides,
  };
}

describe('detectSlowQueries', () => {
  test('flags db spans exceeding the threshold', () => {
    const spans = [
      span({ durationMs: 50 }),
      span({ durationMs: 700 }),
      span({ durationMs: 1500, description: 'SELECT giant' }),
    ];
    const issues = detectSlowQueries('t1', spans);
    expect(issues.length).toBe(2);
    expect(issues.every((i) => i.kind === 'slow-query')).toBe(true);
  });

  test('respects custom threshold', () => {
    const spans = [span({ durationMs: 200 })];
    expect(detectSlowQueries('t1', spans, { slowQueryMs: 100 }).length).toBe(1);
    expect(detectSlowQueries('t1', spans, { slowQueryMs: 500 }).length).toBe(0);
  });

  test('ignores non-db spans', () => {
    const spans = [span({ op: 'http.client', durationMs: 5000 })];
    expect(detectSlowQueries('t1', spans).length).toBe(0);
  });
});

describe('detectNPlusOne', () => {
  test('fires when ≥ 5 sibling queries share parent + description', () => {
    const spans: Span[] = [];
    for (let i = 0; i < 5; i++) {
      spans.push(span({ spanId: `q${i}`, durationMs: 10, parentSpanId: 'p' }));
    }
    const issues = detectNPlusOne('t1', spans);
    expect(issues.length).toBe(1);
    expect(issues[0]?.count).toBe(5);
    expect(issues[0]?.impactMs).toBe(50);
  });

  test('does not fire for 4 repeats with default minRepeats=5', () => {
    const spans: Span[] = [];
    for (let i = 0; i < 4; i++) {
      spans.push(span({ spanId: `q${i}`, parentSpanId: 'p' }));
    }
    expect(detectNPlusOne('t1', spans).length).toBe(0);
  });

  test('respects custom minRepeats', () => {
    const spans: Span[] = [];
    for (let i = 0; i < 3; i++) {
      spans.push(span({ spanId: `q${i}`, parentSpanId: 'p' }));
    }
    expect(detectNPlusOne('t1', spans, { minNPlusOneRepeats: 3 }).length).toBe(1);
  });

  test('different parents do not coalesce', () => {
    const spans: Span[] = [];
    for (let i = 0; i < 6; i++) {
      spans.push(span({ spanId: `q${i}`, parentSpanId: `p${i}` }));
    }
    expect(detectNPlusOne('t1', spans).length).toBe(0);
  });

  test('different descriptions do not coalesce', () => {
    const spans: Span[] = [];
    for (let i = 0; i < 6; i++) {
      spans.push(span({ spanId: `q${i}`, parentSpanId: 'p', description: `SELECT ${i}` }));
    }
    expect(detectNPlusOne('t1', spans).length).toBe(0);
  });

  test('skips spans with empty description', () => {
    const spans: Span[] = [];
    for (let i = 0; i < 10; i++) {
      spans.push(span({ spanId: `q${i}`, parentSpanId: 'p', description: '' }));
    }
    expect(detectNPlusOne('t1', spans).length).toBe(0);
  });
});

describe('detect — combined', () => {
  test('emits both slow-query and n-plus-one issues', () => {
    const spans: Span[] = [];
    spans.push(span({ spanId: 'slow', durationMs: 800, parentSpanId: 'root' }));
    for (let i = 0; i < 5; i++) {
      spans.push(
        span({
          spanId: `q${i}`,
          parentSpanId: 'p',
          durationMs: 10,
          description: 'SELECT n+1',
        }),
      );
    }
    const issues = detect('t1', spans);
    expect(issues.some((i) => i.kind === 'slow-query')).toBe(true);
    expect(issues.some((i) => i.kind === 'n-plus-one')).toBe(true);
  });
});
