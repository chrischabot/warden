import { beforeEach, describe, expect, test } from 'bun:test';
import { LogStore } from '../src/store';
import type { LogEvent, LogLevel } from '../src/types';

let counter = 0;
function log(overrides: Partial<LogEvent> = {}): LogEvent {
  counter++;
  return {
    id: `l${counter}`,
    projectId: '1',
    level: 'info',
    message: 'hello',
    timestamp: 1000,
    ...overrides,
  };
}

describe('LogStore — append', () => {
  let store: LogStore;
  beforeEach(() => {
    store = new LogStore();
  });

  test('size increments per append', () => {
    store.append(log());
    store.append(log());
    expect(store.size()).toBe(2);
    expect(store.totalAppended()).toBe(2);
  });

  test('capacity evicts FIFO', () => {
    const s = new LogStore({ capacity: 3 });
    for (let i = 0; i < 5; i++) s.append(log({ id: `id${i}` }));
    expect(s.size()).toBe(3);
    expect(s.totalAppended()).toBe(5);
    const all = s.snapshot();
    expect(all.map((e) => e.id)).toEqual(['id2', 'id3', 'id4']);
  });
});

describe('LogStore — query filters', () => {
  let store: LogStore;
  beforeEach(() => {
    store = new LogStore();
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error', 'fatal'];
    levels.forEach((level, i) =>
      store.append(
        log({
          id: `e${i}`,
          level,
          message: `msg-${level}`,
          timestamp: 1_000_000 + i * 1000,
          projectId: i < 3 ? '1' : '2',
          traceId: 't1',
        }),
      ),
    );
  });

  test('filter by projectId', () => {
    expect(store.query({ projectId: '1' }).total).toBe(3);
    expect(store.query({ projectId: '2' }).total).toBe(2);
  });

  test('minLevel filters by severity', () => {
    expect(store.query({ minLevel: 'warning' }).total).toBe(3);
    expect(store.query({ minLevel: 'error' }).total).toBe(2);
    expect(store.query({ minLevel: 'fatal' }).total).toBe(1);
  });

  test('filter by trace', () => {
    expect(store.query({ traceId: 't1' }).total).toBe(5);
    expect(store.query({ traceId: 'other' }).total).toBe(0);
  });

  test('time range within data window', () => {
    const r = store.query({ sinceTimestamp: 1_002_000, untilTimestamp: 1_003_000 });
    expect(r.total).toBe(2);
  });

  test('time range with no overlap returns nothing', () => {
    const r = store.query({ sinceTimestamp: 1_000_002_000, untilTimestamp: 1_000_003_000 });
    expect(r.total).toBe(0);
  });

  test('search substring case-insensitive', () => {
    expect(store.query({ searchSubstring: 'WARNING' }).total).toBe(1);
    expect(store.query({ searchSubstring: 'nope' }).total).toBe(0);
  });

  test('sort dir asc/desc', () => {
    const asc = store.query({ projectId: '1' }, { sortDir: 'asc' });
    const desc = store.query({ projectId: '1' }, { sortDir: 'desc' });
    expect(asc.logs[0]?.timestamp).toBeLessThan(asc.logs[asc.logs.length - 1]!.timestamp);
    expect(desc.logs[0]?.timestamp).toBeGreaterThan(desc.logs[desc.logs.length - 1]!.timestamp);
  });

  test('pagination via limit + offset', () => {
    const p1 = store.query({}, { limit: 2, offset: 0 });
    const p2 = store.query({}, { limit: 2, offset: 2 });
    expect(p1.logs.length).toBe(2);
    expect(p2.logs.length).toBe(2);
    expect(p1.logs[0]?.id).not.toBe(p2.logs[0]?.id);
  });
});

describe('LogStore — tag/env/release filters', () => {
  test('filter by environment + release', () => {
    const store = new LogStore();
    store.append(log({ id: 'a', environment: 'prod', release: 'v1' }));
    store.append(log({ id: 'b', environment: 'dev', release: 'v1' }));
    store.append(log({ id: 'c', environment: 'prod', release: 'v2' }));
    expect(store.query({ environment: 'prod' }).total).toBe(2);
    expect(store.query({ environment: 'prod', release: 'v1' }).total).toBe(1);
  });

  test('filter by tag', () => {
    const store = new LogStore();
    store.append(log({ id: 'a', tags: { region: 'eu' } }));
    store.append(log({ id: 'b', tags: { region: 'us' } }));
    expect(store.query({ tagKey: 'region', tagValue: 'eu' }).total).toBe(1);
    expect(store.query({ tagKey: 'region', tagValue: 'asia' }).total).toBe(0);
  });
});

describe('LogStore — snapshot', () => {
  test('returns slice from sinceIndex', () => {
    const store = new LogStore();
    for (let i = 0; i < 10; i++) store.append(log({ id: `s${i}` }));
    expect(store.snapshot(5).length).toBe(5);
    expect(store.snapshot(0).length).toBe(10);
    expect(store.snapshot(20).length).toBe(0);
  });
});