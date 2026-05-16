import { beforeEach, describe, expect, test } from 'bun:test';
import { UptimeStore } from '../src/store';
import type { CheckResult, CheckStatus } from '../src/types';

let resultCounter = 0;
function r(checkId: string, status: CheckStatus, at: number): CheckResult {
  resultCounter++;
  return {
    id: `r${resultCounter}`,
    checkId,
    status,
    httpStatus: status === 'up' ? 200 : 500,
    responseTimeMs: 100,
    observedAt: at,
  };
}

describe('UptimeStore — creation', () => {
  let store: UptimeStore;
  beforeEach(() => {
    store = new UptimeStore();
  });

  test('create + get', () => {
    const c = store.createCheck({
      projectId: '1',
      slug: 'homepage',
      url: 'https://example.com',
      intervalMs: 60_000,
    });
    expect(c.status).toBe('unknown');
    expect(store.getCheck(c.id)?.url).toBe('https://example.com');
  });

  test('slug collision rejected within a project', () => {
    store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://a',
      intervalMs: 60_000,
    });
    expect(() =>
      store.createCheck({
        projectId: '1',
        slug: 'h',
        url: 'https://b',
        intervalMs: 60_000,
      }),
    ).toThrow(RangeError);
  });
});

describe('UptimeStore — streak transitions', () => {
  test('first sample sets initial status', () => {
    const store = new UptimeStore();
    const c = store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://example.com',
      intervalMs: 60_000,
    });
    const o = store.ingest(c.id, r(c.id, 'up', 1000));
    expect(o.previousStatus).toBe('unknown');
    expect(o.currentStatus).toBe('up');
    expect(o.statusChanged).toBe(true);
  });

  test('default 3 fails to declare down; opens an incident', () => {
    const store = new UptimeStore();
    const c = store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://example.com',
      intervalMs: 60_000,
    });
    store.ingest(c.id, r(c.id, 'up', 0));
    store.ingest(c.id, r(c.id, 'down', 1));
    store.ingest(c.id, r(c.id, 'down', 2));
    expect(store.getCheck(c.id)?.status).toBe('up');
    const o = store.ingest(c.id, r(c.id, 'down', 3));
    expect(store.getCheck(c.id)?.status).toBe('down');
    expect(o.openedIncident).toBeDefined();
    expect(store.openIncidents().length).toBe(1);
  });

  test('configurable failuresToDown=1 transitions immediately', () => {
    const store = new UptimeStore();
    const c = store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://example.com',
      intervalMs: 60_000,
      failuresToDown: 1,
    });
    const o = store.ingest(c.id, r(c.id, 'down', 0));
    expect(o.openedIncident).toBeDefined();
    expect(o.currentStatus).toBe('down');
  });

  test('default 2 successes recover; closes the incident', () => {
    const store = new UptimeStore();
    const c = store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://example.com',
      intervalMs: 60_000,
      failuresToDown: 1,
    });
    store.ingest(c.id, r(c.id, 'down', 0));
    store.ingest(c.id, r(c.id, 'up', 1));
    expect(store.getCheck(c.id)?.status).toBe('down');
    const o = store.ingest(c.id, r(c.id, 'up', 2));
    expect(o.closedIncident).toBeDefined();
    expect(store.getCheck(c.id)?.status).toBe('up');
    expect(store.openIncidents().length).toBe(0);
  });

  test('failureCount accumulates across consecutive down samples', () => {
    const store = new UptimeStore();
    const c = store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://example.com',
      intervalMs: 60_000,
      failuresToDown: 1,
    });
    store.ingest(c.id, r(c.id, 'down', 0));
    store.ingest(c.id, r(c.id, 'down', 1));
    store.ingest(c.id, r(c.id, 'down', 2));
    const incidents = store.listIncidents(c.id);
    expect(incidents[0]?.failureCount).toBe(3);
  });

  test('degraded after up is non-incident', () => {
    const store = new UptimeStore();
    const c = store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://example.com',
      intervalMs: 60_000,
    });
    store.ingest(c.id, r(c.id, 'up', 0));
    const o = store.ingest(c.id, r(c.id, 'degraded', 1));
    expect(o.currentStatus).toBe('degraded');
    expect(o.openedIncident).toBeUndefined();
  });
});

describe('UptimeStore — SLO', () => {
  test('uptimePct counts up+degraded over total within window', () => {
    const store = new UptimeStore();
    const c = store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://example.com',
      intervalMs: 60_000,
    });
    for (let i = 0; i < 90; i++) store.ingest(c.id, r(c.id, 'up', 1_000_000 + i * 1000));
    for (let i = 0; i < 10; i++) store.ingest(c.id, r(c.id, 'down', 1_100_000 + i * 1000));
    const slo = store.slo(c.id, 1_200_000, 1_000_000);
    expect(slo.totalSamples).toBe(100);
    expect(slo.uptimePct).toBeCloseTo(90, 0);
  });

  test('empty window reports 100%', () => {
    const store = new UptimeStore();
    const c = store.createCheck({
      projectId: '1',
      slug: 'h',
      url: 'https://example.com',
      intervalMs: 60_000,
    });
    expect(store.slo(c.id, 1_000_000, 1000).uptimePct).toBe(100);
  });
});
