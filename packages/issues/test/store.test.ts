import { beforeEach, describe, expect, test } from 'bun:test';
import { IssueStore } from '../src/store';
import type { IssueEvent } from '../src/types';

function event(overrides: Partial<IssueEvent> = {}): IssueEvent {
  return {
    projectId: '1',
    groupHash: 'abc',
    fingerprint: ['exception:Error', 'value:boom'],
    type: 'error',
    level: 'error',
    message: 'boom',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('IssueStore — create + advance', () => {
  test('first event creates a new group', () => {
    const store = new IssueStore({ projectSlugs: { '1': 'proj' } });
    const r = store.record(event());
    expect(r.created).toBe(true);
    expect(r.group.status).toBe('unresolved');
    expect(r.group.timesSeen).toBe(1);
    expect(r.group.shortId).toBe('PROJ-1');
    expect(r.group.fingerprint).toEqual(['exception:Error', 'value:boom']);
  });

  test('second event with same hash advances counters', () => {
    const store = new IssueStore({ projectSlugs: { '1': 'proj' } });
    store.record(event());
    const r = store.record(event({ timestamp: 1_700_000_001_000 }));
    expect(r.created).toBe(false);
    expect(r.regression).toBe(false);
    expect(r.group.timesSeen).toBe(2);
    expect(r.group.lastSeen).toBe(1_700_000_001_000);
  });

  test('different hashes create distinct groups with distinct short ids', () => {
    const store = new IssueStore({ projectSlugs: { '1': 'p' } });
    const a = store.record(event({ groupHash: 'aaa' }));
    const b = store.record(event({ groupHash: 'bbb' }));
    expect(a.group.id).not.toBe(b.group.id);
    expect(a.group.shortId).toBe('P-1');
    expect(b.group.shortId).toBe('P-2');
  });

  test('user count is the size of the user set', () => {
    const store = new IssueStore();
    store.record(event({ userId: 'u1' }));
    store.record(event({ userId: 'u2' }));
    store.record(event({ userId: 'u1' })); // dup
    const g = store.getByHash('1', 'abc');
    expect(g?.userCount).toBe(2);
  });

  test('level rises to worst seen', () => {
    const store = new IssueStore();
    store.record(event({ level: 'warning' }));
    store.record(event({ level: 'error' }));
    store.record(event({ level: 'info' })); // does not lower
    expect(store.getByHash('1', 'abc')?.level).toBe('error');
  });

  test('first_seen retracts if older event arrives', () => {
    const store = new IssueStore();
    store.record(event({ timestamp: 1_000 }));
    store.record(event({ timestamp: 500 }));
    expect(store.getByHash('1', 'abc')?.firstSeen).toBe(500);
  });

  test('first release sticks; release updates to last seen', () => {
    const store = new IssueStore();
    store.record(event({ release: 'v1.0' }));
    store.record(event({ release: 'v2.0' }));
    const g = store.getByHash('1', 'abc');
    expect(g?.firstRelease).toBe('v1.0');
    expect(g?.release).toBe('v2.0');
  });

  test('isUnhandled is sticky-true', () => {
    const store = new IssueStore();
    store.record(event({ isUnhandled: false }));
    store.record(event({ isUnhandled: true }));
    store.record(event({ isUnhandled: false }));
    expect(store.getByHash('1', 'abc')?.isUnhandled).toBe(true);
  });
});

describe('IssueStore — state machine', () => {
  let store: IssueStore;
  beforeEach(() => {
    store = new IssueStore({ projectSlugs: { '1': 'proj' } });
    store.record(event());
  });

  test('resolve then new event → regression', () => {
    const g = store.getByHash('1', 'abc');
    store.resolve(g!.id);
    expect(store.get(g!.id)?.status).toBe('resolved');
    const r = store.record(event({ timestamp: g!.lastSeen + 1000 }));
    expect(r.regression).toBe(true);
    expect(r.group.status).toBe('unresolved');
    expect(r.group.hasRegressed).toBe(true);
  });

  test('reopen flips back to unresolved without flagging regression', () => {
    const g = store.getByHash('1', 'abc');
    store.resolve(g!.id);
    store.reopen(g!.id);
    expect(store.get(g!.id)?.status).toBe('unresolved');
    expect(store.get(g!.id)?.hasRegressed).toBe(false);
  });

  test('ignore + new events stays ignored until policy fires', () => {
    const g = store.getByHash('1', 'abc');
    store.ignore(g!.id, { untilEvents: 5 });
    expect(store.get(g!.id)?.status).toBe('ignored');
    for (let i = 0; i < 4; i++) {
      const r = store.record(event({ timestamp: 1_700_000_000_000 + i * 1000 }));
      expect(r.regression).toBe(false);
      expect(r.group.status).toBe('ignored');
    }
    const r5 = store.record(event({ timestamp: 1_700_000_010_000 }));
    expect(r5.regression).toBe(true);
    expect(r5.group.status).toBe('unresolved');
  });

  test('ignore untilUsers fires on Nth distinct user after ignore', () => {
    const g = store.getByHash('1', 'abc');
    store.ignore(g!.id, { untilUsers: 3 });
    store.record(event({ userId: 'u1' }));
    store.record(event({ userId: 'u2' }));
    expect(store.get(g!.id)?.status).toBe('ignored');
    const r = store.record(event({ userId: 'u3' }));
    expect(r.regression).toBe(true);
    expect(r.group.status).toBe('unresolved');
  });

  test('ignore untilTimestamp fires at deadline', () => {
    const g = store.getByHash('1', 'abc');
    const deadline = 1_700_000_100_000;
    store.ignore(g!.id, { untilTimestamp: deadline });
    store.record(event({ timestamp: deadline - 1 }));
    expect(store.get(g!.id)?.status).toBe('ignored');
    const r = store.record(event({ timestamp: deadline }));
    expect(r.regression).toBe(true);
  });

  test('archive is sticky; new events do not reopen', () => {
    const g = store.getByHash('1', 'abc');
    store.archive(g!.id);
    for (let i = 0; i < 10; i++) {
      store.record(event({ timestamp: 1_700_000_000_000 + i * 1000 }));
    }
    expect(store.get(g!.id)?.status).toBe('archived');
  });

  test('assign / unassign', () => {
    const g = store.getByHash('1', 'abc');
    store.assign(g!.id, 'u42');
    expect(store.get(g!.id)?.assigneeId).toBe('u42');
    store.assign(g!.id, null);
    expect(store.get(g!.id)?.assigneeId).toBeUndefined();
  });

  test('resolve on unknown id throws', () => {
    expect(() => store.resolve('does-not-exist')).toThrow(RangeError);
  });
});

describe('IssueStore — list + filters', () => {
  let store: IssueStore;

  beforeEach(() => {
    store = new IssueStore({ projectSlugs: { '1': 'a', '2': 'b' } });
    // Three groups in project 1, two in project 2; varied levels/statuses.
    store.record(event({ projectId: '1', groupHash: 'g1', level: 'error', timestamp: 1000 }));
    store.record(event({ projectId: '1', groupHash: 'g2', level: 'warning', timestamp: 2000 }));
    store.record(event({ projectId: '1', groupHash: 'g3', level: 'fatal', timestamp: 3000 }));
    store.record(event({ projectId: '2', groupHash: 'g4', level: 'error', timestamp: 4000 }));
    store.record(event({ projectId: '2', groupHash: 'g5', level: 'info', timestamp: 5000 }));
    const g2 = store.getByHash('1', 'g2');
    if (g2) store.resolve(g2.id);
    const g4 = store.getByHash('2', 'g4');
    if (g4) store.archive(g4.id);
  });

  test('filter by project', () => {
    const r = store.list({ projectId: '1' });
    expect(r.total).toBe(3);
  });

  test('filter by status', () => {
    const r = store.list({ status: ['resolved'] });
    expect(r.total).toBe(1);
    expect(r.groups[0]?.groupHash).toBe('g2');
  });

  test('filter by level', () => {
    const r = store.list({ level: ['fatal', 'error'] });
    expect(r.total).toBe(3);
  });

  test('filter by assignee=null (unassigned)', () => {
    const r = store.list({ assigneeId: null });
    expect(r.total).toBe(5);
  });

  test('filter by assigneeId=u1', () => {
    const g1 = store.getByHash('1', 'g1');
    if (g1) store.assign(g1.id, 'u1');
    const r = store.list({ assigneeId: 'u1' });
    expect(r.total).toBe(1);
    expect(r.groups[0]?.groupHash).toBe('g1');
  });

  test('sort by last_seen desc by default', () => {
    const r = store.list({});
    expect(r.groups.map((g) => g.groupHash)).toEqual(['g5', 'g4', 'g3', 'g2', 'g1']);
  });

  test('sort by first_seen asc', () => {
    const r = store.list({}, { sortBy: 'first_seen', sortDir: 'asc' });
    expect(r.groups.map((g) => g.groupHash)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
  });

  test('pagination via limit/offset', () => {
    const page1 = store.list({}, { limit: 2, offset: 0 });
    const page2 = store.list({}, { limit: 2, offset: 2 });
    expect(page1.groups.length).toBe(2);
    expect(page2.groups.length).toBe(2);
    expect(page1.groups[0]?.id).not.toBe(page2.groups[0]?.id);
  });

  test('search substring matches message and shortId', () => {
    const r = store.list({ searchSubstring: 'A-1' });
    expect(r.groups.some((g) => g.shortId === 'A-1')).toBe(true);
  });

  test('bulk operation applies to matched groups', () => {
    const changed = store.bulk({ projectId: '1', status: ['unresolved'] }, (id) =>
      store.archive(id),
    );
    expect(changed).toBe(2); // g1 and g3
    expect(store.getByHash('1', 'g1')?.status).toBe('archived');
    expect(store.getByHash('1', 'g3')?.status).toBe('archived');
    expect(store.getByHash('1', 'g2')?.status).toBe('resolved'); // untouched
  });
});

describe('IssueStore — fallback short-id slug', () => {
  test('uses P<project_id> when no slug is registered', () => {
    const store = new IssueStore();
    const r = store.record(event({ projectId: '42' }));
    expect(r.group.shortId).toBe('P42-1');
  });
});
