import { describe, expect, test } from 'bun:test';
import {
  aggregateTransactions,
  apdex,
  failureRate,
  isFailedStatus,
  percentile,
  throughputPerMinute,
} from '../src/stats';
import type { Transaction } from '../src/types';

describe('percentile', () => {
  test('empty array returns NaN', () => {
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });

  test('single element returns that element', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  test('median of [1..9]', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9], 0.5)).toBe(5);
  });

  test('p99 of [1..100]', () => {
    const arr: number[] = [];
    for (let i = 1; i <= 100; i++) arr.push(i);
    expect(percentile(arr, 0.99)).toBeCloseTo(99.01, 2);
  });

  test('linear interpolation between neighbours', () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
  });

  test('rejects q out of [0,1]', () => {
    expect(() => percentile([1], -0.1)).toThrow(RangeError);
    expect(() => percentile([1], 1.1)).toThrow(RangeError);
  });

  test('accepts TypedArray input', () => {
    expect(percentile(new Float64Array([1, 2, 3, 4, 5]), 0.5)).toBe(3);
  });
});

describe('throughputPerMinute', () => {
  test('empty returns 0', () => {
    expect(throughputPerMinute([])).toBe(0);
  });

  test('all same timestamp returns count', () => {
    expect(throughputPerMinute([1000, 1000, 1000])).toBe(3);
  });

  test('61 events spanning 60 seconds = 61 per minute', () => {
    const ts: number[] = [];
    for (let i = 0; i <= 60; i++) ts.push(i * 1000);
    expect(throughputPerMinute(ts)).toBeCloseTo(61, 1);
  });
});

describe('failureRate', () => {
  function tx(status: Transaction['status']): Transaction {
    return {
      eventId: Math.random().toString(36),
      projectId: '1',
      traceId: 't',
      spanId: 's',
      transaction: 'tx',
      op: 'http.server',
      platform: 'javascript',
      startTimestamp: 0,
      endTimestamp: 100,
      durationMs: 100,
      status,
    };
  }

  test('empty returns 0', () => {
    expect(failureRate([])).toBe(0);
  });

  test('all ok returns 0', () => {
    expect(failureRate([tx('ok'), tx('ok')])).toBe(0);
  });

  test('all failed returns 1', () => {
    expect(failureRate([tx('internal_error'), tx('aborted')])).toBe(1);
  });

  test('mixed returns ratio', () => {
    expect(failureRate([tx('ok'), tx('ok'), tx('internal_error'), tx('aborted')])).toBe(0.5);
  });

  test('unknown is counted as success', () => {
    expect(isFailedStatus('unknown')).toBe(false);
    expect(failureRate([tx('unknown')])).toBe(0);
  });

  test('cancelled is success', () => {
    expect(isFailedStatus('cancelled')).toBe(false);
    expect(failureRate([tx('cancelled')])).toBe(0);
  });
});

describe('apdex', () => {
  test('empty distribution is 1.0', () => {
    expect(apdex([], 300)).toBe(1.0);
  });

  test('all satisfied = 1.0', () => {
    expect(apdex([10, 20, 50], 300)).toBe(1.0);
  });

  test('all frustrated = 0.0', () => {
    expect(apdex([2000, 5000], 300)).toBe(0.0);
  });

  test('all tolerating = 0.5', () => {
    // T=300, 4T=1200. 600 and 1000 are in (T, 4T].
    expect(apdex([600, 1000], 300)).toBe(0.5);
  });

  test('mixed: 2 satisfied + 1 tolerating + 1 frustrated / 4', () => {
    // T=100, 4T=400. 50 sat, 75 sat, 200 tol, 500 frust.
    expect(apdex([50, 75, 200, 500], 100)).toBeCloseTo((2 + 0.5) / 4, 6);
  });

  test('rejects bad threshold', () => {
    expect(() => apdex([100], 0)).toThrow(RangeError);
    expect(() => apdex([100], -1)).toThrow(RangeError);
  });
});

describe('aggregateTransactions', () => {
  function tx(durationMs: number, ts: number, status: Transaction['status'] = 'ok'): Transaction {
    return {
      eventId: Math.random().toString(36),
      projectId: '1',
      traceId: 't',
      spanId: 's',
      transaction: 'GET /api',
      op: 'http.server',
      platform: 'javascript',
      startTimestamp: ts,
      endTimestamp: ts + durationMs,
      durationMs,
      status,
    };
  }

  test('empty input', () => {
    const a = aggregateTransactions([]);
    expect(a.count).toBe(0);
    expect(a.apdex).toBe(1.0);
    expect(a.failureRate).toBe(0);
  });

  test('full aggregate', () => {
    const txs: Transaction[] = [];
    for (let i = 1; i <= 100; i++) txs.push(tx(i, i * 1000));
    const a = aggregateTransactions(txs, { apdexThresholdMs: 50 });
    expect(a.count).toBe(100);
    expect(a.min).toBe(1);
    expect(a.max).toBe(100);
    expect(a.avg).toBeCloseTo(50.5, 6);
    expect(a.p50).toBeCloseTo(50.5, 2);
    expect(a.p95).toBeCloseTo(95.05, 2);
    expect(a.p99).toBeCloseTo(99.01, 2);
  });
});
