import { beforeEach, describe, expect, test } from 'bun:test';
import { ReplayStore } from '../src/store';
import type { ReplaySegment } from '../src/types';

function segment(overrides: Partial<ReplaySegment> = {}): ReplaySegment {
  return {
    replayId: 'r1',
    sequenceId: 0,
    receivedAt: 1000,
    startTimestamp: 1000,
    endTimestamp: 2000,
    payload: new Uint8Array([1, 2, 3]),
    errorCount: 0,
    ...overrides,
  };
}

describe('ReplayStore — creation', () => {
  let store: ReplayStore;
  beforeEach(() => {
    store = new ReplayStore();
  });

  test('createReplay registers initial metadata', () => {
    const r = store.createReplay({
      replayId: 'r1',
      projectId: '1',
      startedAt: 1000,
      release: 'v1',
      environment: 'prod',
      user: { id: 'u' },
    });
    expect(r.status).toBe('ongoing');
    expect(r.releases).toEqual(['v1']);
    expect(r.environment).toBe('prod');
    expect(r.user?.id).toBe('u');
  });

  test('duplicate id rejects', () => {
    store.createReplay({ replayId: 'r1', projectId: '1', startedAt: 0 });
    expect(() => store.createReplay({ replayId: 'r1', projectId: '1', startedAt: 1 })).toThrow(
      RangeError,
    );
  });
});

describe('ReplayStore — segments', () => {
  let store: ReplayStore;
  beforeEach(() => {
    store = new ReplayStore();
    store.createReplay({ replayId: 'r1', projectId: '1', startedAt: 1000 });
  });

  test('record advances duration + segmentCount', () => {
    store.recordSegment(segment({ sequenceId: 0 }));
    const r = store.recordSegment(segment({ sequenceId: 1, endTimestamp: 5000 }));
    expect(r.segmentCount).toBe(2);
    expect(r.lastSeenAt).toBe(5000);
    expect(r.durationMs).toBe(4000);
  });

  test('errorCount accumulates', () => {
    store.recordSegment(segment({ sequenceId: 0, errorCount: 2 }));
    store.recordSegment(segment({ sequenceId: 1, errorCount: 3 }));
    expect(store.get('r1')?.errorCount).toBe(5);
  });

  test('urls de-duplicate in encounter order', () => {
    store.recordSegment(segment({ sequenceId: 0, url: 'https://a' }));
    store.recordSegment(segment({ sequenceId: 1, url: 'https://b' }));
    store.recordSegment(segment({ sequenceId: 2, url: 'https://a' }));
    expect(store.get('r1')?.urls).toEqual(['https://a', 'https://b']);
  });

  test('sequenceId must strictly increase', () => {
    store.recordSegment(segment({ sequenceId: 5 }));
    expect(() => store.recordSegment(segment({ sequenceId: 5 }))).toThrow(RangeError);
    expect(() => store.recordSegment(segment({ sequenceId: 2 }))).toThrow(RangeError);
  });

  test('isFinal completes the replay; further segments reject', () => {
    store.recordSegment(segment({ sequenceId: 0, isFinal: true }));
    expect(store.get('r1')?.status).toBe('completed');
    expect(() => store.recordSegment(segment({ sequenceId: 1 }))).toThrow(RangeError);
  });

  test('segments() returns in record order', () => {
    store.recordSegment(segment({ sequenceId: 0 }));
    store.recordSegment(segment({ sequenceId: 3 }));
    store.recordSegment(segment({ sequenceId: 4 }));
    const segs = store.segments('r1');
    expect(segs.map((s) => s.sequenceId)).toEqual([0, 3, 4]);
  });
});

describe('ReplayStore — list', () => {
  let store: ReplayStore;
  beforeEach(() => {
    store = new ReplayStore();
    store.createReplay({ replayId: 'a', projectId: '1', startedAt: 1000, user: { id: 'u1' } });
    store.createReplay({ replayId: 'b', projectId: '1', startedAt: 2000, user: { id: 'u2' } });
    store.createReplay({ replayId: 'c', projectId: '2', startedAt: 3000 });
    store.recordSegment(segment({ replayId: 'a', sequenceId: 0, errorCount: 2, url: '/x' }));
    store.recordSegment(segment({ replayId: 'b', sequenceId: 0, url: '/y' }));
  });

  test('filter by project', () => {
    expect(store.list({ projectId: '1' }).total).toBe(2);
  });

  test('filter by user', () => {
    expect(store.list({ userId: 'u1' }).total).toBe(1);
  });

  test('filter by url', () => {
    expect(store.list({ url: '/x' }).total).toBe(1);
  });

  test('filter by hasErrors', () => {
    expect(store.list({ hasErrors: true }).total).toBe(1);
    expect(store.list({ hasErrors: false }).total).toBe(2);
  });

  test('sort by started_at desc by default', () => {
    const r = store.list({});
    expect(r.replays.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  test('sort by error_count desc', () => {
    const r = store.list({}, { sortBy: 'error_count' });
    expect(r.replays[0]?.id).toBe('a');
  });
});

describe('ReplayStore — observeRelease', () => {
  test('appends a new release', () => {
    const store = new ReplayStore();
    store.createReplay({ replayId: 'r1', projectId: '1', startedAt: 0, release: 'v1' });
    store.observeRelease('r1', 'v2');
    expect(store.get('r1')?.releases).toEqual(['v1', 'v2']);
  });

  test('idempotent on duplicate', () => {
    const store = new ReplayStore();
    store.createReplay({ replayId: 'r1', projectId: '1', startedAt: 0, release: 'v1' });
    store.observeRelease('r1', 'v1');
    expect(store.get('r1')?.releases).toEqual(['v1']);
  });

  test('unknown replay is a no-op (not an error)', () => {
    const store = new ReplayStore();
    expect(() => store.observeRelease('does-not-exist', 'v1')).not.toThrow();
  });
});
