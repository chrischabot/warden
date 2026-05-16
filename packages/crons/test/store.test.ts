import { beforeEach, describe, expect, test } from 'bun:test';
import { MonitorStore } from '../src/store';
import type { Schedule } from '../src/types';

const HOURLY: Schedule = { type: 'crontab', expression: '0 * * * *' };
const EVERY_MINUTE: Schedule = { type: 'crontab', expression: '* * * * *' };

function utc(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h, mi, 0, 0);
}

describe('MonitorStore — lifecycle', () => {
  let store: MonitorStore;
  beforeEach(() => {
    store = new MonitorStore();
  });

  test('create + get', () => {
    const m = store.createMonitor({
      projectId: '1',
      slug: 'backup',
      schedule: HOURLY,
      maxRuntimeMs: 300_000,
      checkinMarginMs: 60_000,
    });
    expect(m.status).toBe('never-run');
    expect(store.getMonitor(m.id)?.slug).toBe('backup');
    expect(store.getMonitorBySlug('1', 'backup')?.id).toBe(m.id);
  });

  test('slug collision across the same project', () => {
    store.createMonitor({
      projectId: '1',
      slug: 'backup',
      schedule: HOURLY,
      maxRuntimeMs: 60_000,
      checkinMarginMs: 30_000,
    });
    expect(() =>
      store.createMonitor({
        projectId: '1',
        slug: 'backup',
        schedule: HOURLY,
        maxRuntimeMs: 60_000,
        checkinMarginMs: 30_000,
      }),
    ).toThrow(RangeError);
  });

  test('slug isolation across projects', () => {
    store.createMonitor({
      projectId: '1',
      slug: 'backup',
      schedule: HOURLY,
      maxRuntimeMs: 1,
      checkinMarginMs: 1,
    });
    expect(() =>
      store.createMonitor({
        projectId: '2',
        slug: 'backup',
        schedule: HOURLY,
        maxRuntimeMs: 1,
        checkinMarginMs: 1,
      }),
    ).not.toThrow();
  });

  test('setEnabled toggles status', () => {
    const m = store.createMonitor({
      projectId: '1',
      slug: 'backup',
      schedule: HOURLY,
      maxRuntimeMs: 1,
      checkinMarginMs: 1,
    });
    store.setEnabled(m.id, false);
    expect(store.getMonitor(m.id)?.status).toBe('disabled');
    store.setEnabled(m.id, true);
    expect(store.getMonitor(m.id)?.status).toBe('never-run');
  });
});

describe('MonitorStore — check-ins', () => {
  let store: MonitorStore;
  beforeEach(() => {
    store = new MonitorStore();
  });

  test('in_progress + ok closes a run with ok status', () => {
    const m = store.createMonitor({
      projectId: '1',
      slug: 'backup',
      schedule: HOURLY,
      maxRuntimeMs: 60 * 60_000,
      checkinMarginMs: 60_000,
    });
    const tickAt = utc(2026, 5, 16, 12, 0);
    const start = store.checkIn(m.id, 'in_progress', tickAt + 1000, { tickAt });
    expect(start.transition).toBeUndefined();
    const done = store.checkIn(m.id, 'ok', tickAt + 30_000, {
      checkinId: start.checkIn.id,
    });
    expect(done.transition?.current).toBe('ok');
    expect(store.getMonitor(m.id)?.status).toBe('ok');
    const checkIns = store.listCheckIns(m.id);
    expect(checkIns[1]?.durationMs).toBe(29_000);
  });

  test('ok → error transitions', () => {
    const m = store.createMonitor({
      projectId: '1',
      slug: 'backup',
      schedule: HOURLY,
      maxRuntimeMs: 60_000,
      checkinMarginMs: 30_000,
    });
    const tickAt = utc(2026, 5, 16, 12, 0);
    const start = store.checkIn(m.id, 'in_progress', tickAt + 1000, { tickAt });
    store.checkIn(m.id, 'ok', tickAt + 5000, { checkinId: start.checkIn.id });
    const start2 = store.checkIn(m.id, 'in_progress', tickAt + 60 * 60_000 + 1000, {
      tickAt: tickAt + 60 * 60_000,
    });
    const done = store.checkIn(m.id, 'error', tickAt + 60 * 60_000 + 5000, {
      checkinId: start2.checkIn.id,
    });
    expect(done.transition?.previous).toBe('ok');
    expect(done.transition?.current).toBe('error');
  });
});

describe('MonitorStore — evaluate', () => {
  test('marks missed when tick + margin elapsed without check-in', () => {
    const store = new MonitorStore();
    const m = store.createMonitor({
      projectId: '1',
      slug: 'tick',
      schedule: EVERY_MINUTE,
      maxRuntimeMs: 60_000,
      checkinMarginMs: 30_000,
    });
    // Plant a check-in 60 minutes ago so the missed-window walk has
    // a back-stop and we look at ticks since then.
    const baseTick = utc(2026, 5, 16, 12, 0);
    const start = store.checkIn(m.id, 'in_progress', baseTick + 1_000, { tickAt: baseTick });
    store.checkIn(m.id, 'ok', baseTick + 5_000, { checkinId: start.checkIn.id });
    expect(store.getMonitor(m.id)?.status).toBe('ok');

    // Several minutes later with no check-ins: evaluate at +5 minutes.
    const now = baseTick + 5 * 60_000 + 1; // 5 minutes + 1ms
    const transitions = store.evaluate(now);
    const missed = transitions.find((t) => t.current === 'missed');
    expect(missed).toBeDefined();
    expect(store.getMonitor(m.id)?.status).toBe('missed');
  });

  test('marks timeout when an open run exceeds maxRuntimeMs', () => {
    const store = new MonitorStore();
    const m = store.createMonitor({
      projectId: '1',
      slug: 'long',
      schedule: HOURLY,
      maxRuntimeMs: 60_000,
      checkinMarginMs: 30_000,
    });
    const tickAt = utc(2026, 5, 16, 12, 0);
    store.checkIn(m.id, 'in_progress', tickAt + 100, { tickAt });
    const transitions = store.evaluate(tickAt + 70_000);
    const timeout = transitions.find((t) => t.current === 'timeout');
    expect(timeout).toBeDefined();
    expect(store.getMonitor(m.id)?.status).toBe('timeout');
  });

  test('does not double-mark already-missed ticks', () => {
    const store = new MonitorStore();
    const m = store.createMonitor({
      projectId: '1',
      slug: 't',
      schedule: EVERY_MINUTE,
      maxRuntimeMs: 60_000,
      checkinMarginMs: 30_000,
    });
    const baseTick = utc(2026, 5, 16, 12, 0);
    const start = store.checkIn(m.id, 'in_progress', baseTick + 1_000, { tickAt: baseTick });
    store.checkIn(m.id, 'ok', baseTick + 5_000, { checkinId: start.checkIn.id });
    const now = baseTick + 5 * 60_000 + 1;
    const t1 = store.evaluate(now);
    const t2 = store.evaluate(now);
    expect(t1.length).toBeGreaterThan(0);
    expect(t2.length).toBe(0);
  });

  test('disabled monitors do not produce transitions', () => {
    const store = new MonitorStore();
    const m = store.createMonitor({
      projectId: '1',
      slug: 't',
      schedule: EVERY_MINUTE,
      maxRuntimeMs: 60_000,
      checkinMarginMs: 30_000,
      enabled: false,
    });
    expect(store.evaluate(Date.now()).length).toBe(0);
    expect(store.getMonitor(m.id)?.status).toBe('never-run');
  });
});
