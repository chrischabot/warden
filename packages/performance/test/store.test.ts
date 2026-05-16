import { beforeEach, describe, expect, test } from 'bun:test';
import { TransactionStore } from '../src/store';
import type { Span, Transaction } from '../src/types';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    eventId: 'e' + Math.random().toString(36).slice(2, 8),
    projectId: '1',
    traceId: 't1',
    spanId: 's1',
    transaction: 'GET /api/users',
    op: 'http.server',
    platform: 'javascript',
    startTimestamp: 1000,
    endTimestamp: 1200,
    durationMs: 200,
    status: 'ok',
    ...overrides,
  };
}

describe('TransactionStore', () => {
  let store: TransactionStore;
  beforeEach(() => {
    store = new TransactionStore();
  });

  test('record + get', () => {
    const t = tx();
    store.record(t);
    expect(store.get(t.eventId)?.transaction).toBe('GET /api/users');
  });

  test('record indexes by trace_id', () => {
    store.record(tx({ eventId: 'a', traceId: 't1' }));
    store.record(tx({ eventId: 'b', traceId: 't1' }));
    store.record(tx({ eventId: 'c', traceId: 't2' }));
    expect(store.transactionsForTrace('t1').length).toBe(2);
    expect(store.transactionsForTrace('t2').length).toBe(1);
  });

  test('inline spans are persisted with the transaction', () => {
    const spans: Span[] = [
      {
        traceId: 't1',
        spanId: 'child1',
        parentSpanId: 's1',
        op: 'db',
        description: 'SELECT 1',
        startTimestamp: 1010,
        endTimestamp: 1040,
        durationMs: 30,
        status: 'ok',
      },
    ];
    store.record(tx({ spans }));
    expect(store.spansForTrace('t1').length).toBe(1);
  });

  test('recordSpans appends to a trace', () => {
    store.record(tx());
    store.recordSpans('t1', [
      {
        traceId: 't1',
        spanId: 's2',
        parentSpanId: 's1',
        op: 'http.client',
        startTimestamp: 1050,
        endTimestamp: 1100,
        durationMs: 50,
        status: 'ok',
      },
    ]);
    expect(store.spansForTrace('t1').length).toBe(1);
  });

  test('list filters by project + status', () => {
    store.record(tx({ eventId: 'a', projectId: '1', status: 'ok' }));
    store.record(tx({ eventId: 'b', projectId: '1', status: 'internal_error' }));
    store.record(tx({ eventId: 'c', projectId: '2', status: 'internal_error' }));
    const r = store.list({ projectId: '1', status: ['internal_error'] });
    expect(r.total).toBe(1);
    expect(r.transactions[0]?.eventId).toBe('b');
  });

  test('list filters by duration range', () => {
    store.record(tx({ eventId: 'fast', durationMs: 50 }));
    store.record(tx({ eventId: 'mid', durationMs: 500 }));
    store.record(tx({ eventId: 'slow', durationMs: 5000 }));
    const r = store.list({ minDurationMs: 100, maxDurationMs: 1000 });
    expect(r.transactions[0]?.eventId).toBe('mid');
  });

  test('sort by duration desc', () => {
    store.record(tx({ eventId: 'a', durationMs: 100, startTimestamp: 1 }));
    store.record(tx({ eventId: 'b', durationMs: 500, startTimestamp: 2 }));
    store.record(tx({ eventId: 'c', durationMs: 300, startTimestamp: 3 }));
    const r = store.list({}, { sortBy: 'duration', sortDir: 'desc' });
    expect(r.transactions.map((t) => t.eventId)).toEqual(['b', 'c', 'a']);
  });

  test('pagination via limit + offset', () => {
    for (let i = 0; i < 10; i++) {
      store.record(tx({ eventId: `t${i}`, startTimestamp: i }));
    }
    const r1 = store.list({}, { limit: 3, offset: 0 });
    const r2 = store.list({}, { limit: 3, offset: 3 });
    expect(r1.transactions.length).toBe(3);
    expect(r2.transactions.length).toBe(3);
    expect(r1.transactions[0]?.eventId).not.toBe(r2.transactions[0]?.eventId);
  });

  test('re-recording same eventId with different trace evicts prior trace index', () => {
    store.record(tx({ eventId: 'a', traceId: 't1' }));
    store.record(tx({ eventId: 'a', traceId: 't2' }));
    expect(store.transactionsForTrace('t1').length).toBe(0);
    expect(store.transactionsForTrace('t2').length).toBe(1);
  });

  test('re-recording drops the old inline spans', () => {
    store.record(
      tx({
        eventId: 'a',
        traceId: 't1',
        spans: [
          {
            traceId: 't1',
            spanId: 'old',
            parentSpanId: 's1',
            op: 'db',
            description: 'old',
            startTimestamp: 1010,
            endTimestamp: 1040,
            durationMs: 30,
            status: 'ok',
          },
        ],
      }),
    );
    store.record(tx({ eventId: 'a', traceId: 't1' }));
    expect(store.spansForTrace('t1').length).toBe(0);
  });
});
