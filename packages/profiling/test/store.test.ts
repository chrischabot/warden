import { describe, expect, test } from 'bun:test';
import { ProfileStore } from '../src/store';
import type { Profile } from '../src/types';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p' + Math.random().toString(36).slice(2, 8),
    projectId: '1',
    platform: 'javascript',
    capturedAt: 1000,
    durationNs: 1_000_000_000,
    samplingRateHz: 101,
    frames: [],
    threads: [],
    samples: [],
    ...overrides,
  };
}

describe('ProfileStore', () => {
  test('record + get', () => {
    const store = new ProfileStore();
    const p = profile({ id: 'a' });
    store.record(p);
    expect(store.get('a')?.id).toBe('a');
  });

  test('list filters by project', () => {
    const store = new ProfileStore();
    store.record(profile({ id: 'a', projectId: '1' }));
    store.record(profile({ id: 'b', projectId: '2' }));
    expect(store.list({ projectId: '1' }).length).toBe(1);
  });

  test('list filters by trace', () => {
    const store = new ProfileStore();
    store.record(profile({ id: 'a', traceId: 't1' }));
    store.record(profile({ id: 'b', traceId: 't2' }));
    expect(store.list({ traceId: 't1' }).length).toBe(1);
  });

  test('list sorts by capturedAt desc', () => {
    const store = new ProfileStore();
    store.record(profile({ id: 'a', capturedAt: 100 }));
    store.record(profile({ id: 'b', capturedAt: 300 }));
    store.record(profile({ id: 'c', capturedAt: 200 }));
    const list = store.list();
    expect(list.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  test('time-range filters', () => {
    const store = new ProfileStore();
    store.record(profile({ id: 'a', capturedAt: 100 }));
    store.record(profile({ id: 'b', capturedAt: 300 }));
    store.record(profile({ id: 'c', capturedAt: 500 }));
    expect(store.list({ sinceTimestamp: 200 }).length).toBe(2);
    expect(store.list({ untilTimestamp: 200 }).length).toBe(1);
    expect(store.list({ sinceTimestamp: 200, untilTimestamp: 400 }).length).toBe(1);
  });
});
