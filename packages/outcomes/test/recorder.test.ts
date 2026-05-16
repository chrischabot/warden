import { describe, expect, test } from 'bun:test';
import type { Outcome } from '../src/index';
import { AggregatingOutcomeRecorder, BufferedOutcomeRecorder, OUTCOME_REASONS } from '../src/index';

describe('BufferedOutcomeRecorder', () => {
  test('record + peek', () => {
    const r = new BufferedOutcomeRecorder();
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted' });
    r.record({ projectId: '1', dataCategory: 'event', reason: 'rate_limited', quantity: 3 });
    expect(r.peek().length).toBe(2);
    expect(r.peek()[0]?.quantity).toBe(1);
    expect(r.peek()[1]?.quantity).toBe(3);
  });

  test('drain returns a snapshot and clears state', () => {
    const r = new BufferedOutcomeRecorder();
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted' });
    const drained = r.drain();
    expect(drained.length).toBe(1);
    expect(r.peek().length).toBe(0);
  });

  test('defaults: timestamp filled, quantity = 1', () => {
    const r = new BufferedOutcomeRecorder();
    const before = Date.now();
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted' });
    const after = Date.now();
    const o = r.peek()[0] as Outcome;
    expect(o.timestamp).toBeGreaterThanOrEqual(before);
    expect(o.timestamp).toBeLessThanOrEqual(after);
    expect(o.quantity).toBe(1);
  });

  test('result objects are frozen', () => {
    const r = new BufferedOutcomeRecorder();
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted' });
    const o = r.peek()[0] as Outcome;
    expect(Object.isFrozen(o)).toBe(true);
  });
});

describe('AggregatingOutcomeRecorder', () => {
  test('collapses same (project, category, reason, bucket) into one count', async () => {
    let captured: readonly Outcome[] | undefined;
    const r = new AggregatingOutcomeRecorder({
      bucketMs: 60_000,
      onFlush: (rec) => {
        captured = rec;
      },
    });
    const t = 1_700_000_000_000; // bucket 28333333.333... → floor to 1_699_999_980_000
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted', timestamp: t });
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted', timestamp: t + 1000 });
    r.record({
      projectId: '1',
      dataCategory: 'event',
      reason: 'accepted',
      timestamp: t + 30_000,
    });
    expect(r.pendingKeyCount).toBe(1);
    await r.flush();
    expect(captured?.length).toBe(1);
    expect(captured?.[0]?.quantity).toBe(3);
  });

  test('distinct keys stay separate', async () => {
    let captured: readonly Outcome[] | undefined;
    const r = new AggregatingOutcomeRecorder({
      bucketMs: 60_000,
      onFlush: (rec) => {
        captured = rec;
      },
    });
    const t = 0;
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted', timestamp: t });
    r.record({ projectId: '1', dataCategory: 'event', reason: 'rate_limited', timestamp: t });
    r.record({ projectId: '2', dataCategory: 'event', reason: 'accepted', timestamp: t });
    r.record({
      projectId: '1',
      dataCategory: 'attachment',
      reason: 'accepted',
      timestamp: t,
    });
    expect(r.pendingKeyCount).toBe(4);
    await r.flush();
    expect(captured?.length).toBe(4);
  });

  test('bucket boundary splits same logical event', async () => {
    let captured: readonly Outcome[] | undefined;
    const r = new AggregatingOutcomeRecorder({
      bucketMs: 60_000,
      onFlush: (rec) => {
        captured = rec;
      },
    });
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted', timestamp: 0 });
    r.record({
      projectId: '1',
      dataCategory: 'event',
      reason: 'accepted',
      timestamp: 60_001,
    });
    expect(r.pendingKeyCount).toBe(2);
    await r.flush();
    expect(captured?.length).toBe(2);
    const buckets = captured?.map((o) => o.timestamp).sort() ?? [];
    expect(buckets[0]).toBe(0);
    expect(buckets[1]).toBe(60_000);
  });

  test('flush clears state', async () => {
    let calls = 0;
    const r = new AggregatingOutcomeRecorder({
      bucketMs: 1000,
      onFlush: () => {
        calls++;
      },
    });
    r.record({ projectId: '1', dataCategory: 'event', reason: 'accepted', timestamp: 0 });
    await r.flush();
    await r.flush(); // second flush has nothing
    expect(calls).toBe(1);
    expect(r.pendingKeyCount).toBe(0);
  });

  test('quantity accumulates with batched record calls', async () => {
    let captured: readonly Outcome[] | undefined;
    const r = new AggregatingOutcomeRecorder({
      bucketMs: 60_000,
      onFlush: (rec) => {
        captured = rec;
      },
    });
    r.record({
      projectId: '1',
      dataCategory: 'event',
      reason: 'accepted',
      timestamp: 0,
      quantity: 5,
    });
    r.record({
      projectId: '1',
      dataCategory: 'event',
      reason: 'accepted',
      timestamp: 30_000,
      quantity: 7,
    });
    await r.flush();
    expect(captured?.length).toBe(1);
    expect(captured?.[0]?.quantity).toBe(12);
  });

  test('rejects bad bucketMs', () => {
    expect(
      () =>
        new AggregatingOutcomeRecorder({
          bucketMs: 0,
          onFlush: () => {
            // nothing
          },
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new AggregatingOutcomeRecorder({
          bucketMs: -1,
          onFlush: () => {
            // nothing
          },
        }),
    ).toThrow(RangeError);
  });
});

describe('OUTCOME_REASONS — stability guard', () => {
  test('contains all spec-listed categories', () => {
    expect(([...OUTCOME_REASONS] as string[]).sort()).toEqual(
      [
        'abuse',
        'accepted',
        'client_discard',
        'filtered',
        'invalid',
        'network_error',
        'over_quota',
        'rate_limited',
      ].sort(),
    );
  });
});
