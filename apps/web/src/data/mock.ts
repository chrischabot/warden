/**
 * Mock data used by the UI pages.
 *
 * Production wires React Query (or similar) against the @sr/api
 * HTTP surface (Ring 4 deliverable, separate app); this file
 * stands in until that lands so each page renders something
 * believable in development and tests.
 */

import type {
  CronMonitorView,
  IssueView,
  ReleaseView,
  TransactionView,
  UptimeCheckView,
} from './types';

export const MOCK_ISSUES: readonly IssueView[] = [
  {
    id: 'g1',
    shortId: 'WEB-128',
    title: "TypeError: Cannot read properties of undefined (reading 'user')",
    culprit: 'renderHeader at src/components/Header.tsx:42',
    level: 'error',
    status: 'unresolved',
    eventsCount: 4_218,
    usersAffected: 132,
    lastSeen: '2026-05-16T11:58:00Z',
    project: 'web',
    isUnhandled: true,
  },
  {
    id: 'g2',
    shortId: 'API-203',
    title: "PoolExhausted: timed out waiting for connection (driver=pg)",
    culprit: 'getConnection at src/db/pool.ts:88',
    level: 'fatal',
    status: 'unresolved',
    eventsCount: 92,
    usersAffected: 7,
    lastSeen: '2026-05-16T11:32:00Z',
    project: 'api',
    isUnhandled: true,
  },
  {
    id: 'g3',
    shortId: 'WEB-99',
    title: 'ChunkLoadError: Loading chunk 42 failed',
    culprit: 'webpack chunk load',
    level: 'warning',
    status: 'ignored',
    eventsCount: 17,
    usersAffected: 12,
    lastSeen: '2026-05-16T09:01:00Z',
    project: 'web',
    isUnhandled: false,
  },
  {
    id: 'g4',
    shortId: 'WORKER-12',
    title: 'JobTimeout: image-resize exceeded 60s budget',
    culprit: 'enqueueJob at src/jobs/image.ts:23',
    level: 'error',
    status: 'resolved',
    eventsCount: 451,
    usersAffected: 38,
    lastSeen: '2026-05-15T22:18:00Z',
    project: 'worker',
    isUnhandled: false,
  },
];

export const MOCK_TRANSACTIONS: readonly TransactionView[] = [
  {
    id: 't1',
    name: 'GET /api/users',
    op: 'http.server',
    p50: 18,
    p95: 42,
    p99: 81,
    throughputPerMin: 1200,
    failureRate: 0.004,
    apdex: 0.99,
  },
  {
    id: 't2',
    name: 'POST /api/orders',
    op: 'http.server',
    p50: 88,
    p95: 312,
    p99: 1980,
    throughputPerMin: 410,
    failureRate: 0.018,
    apdex: 0.91,
  },
  {
    id: 't3',
    name: 'GET /api/feed',
    op: 'http.server',
    p50: 32,
    p95: 145,
    p99: 380,
    throughputPerMin: 2300,
    failureRate: 0.001,
    apdex: 0.97,
  },
  {
    id: 't4',
    name: 'sync.shippingProvider',
    op: 'queue.process',
    p50: 510,
    p95: 2800,
    p99: 6800,
    throughputPerMin: 12,
    failureRate: 0.04,
    apdex: 0.74,
  },
];

export const MOCK_CRONS: readonly CronMonitorView[] = [
  {
    id: 'cm1',
    slug: 'backup-nightly',
    schedule: '0 3 * * *',
    status: 'ok',
    lastRunAt: '2026-05-16T03:00:00Z',
    lastRunDurationMs: 18_200,
    nextRunAt: '2026-05-17T03:00:00Z',
  },
  {
    id: 'cm2',
    slug: 'reconcile-charges',
    schedule: '*/30 * * * *',
    status: 'missed',
    lastRunAt: '2026-05-16T10:30:00Z',
    nextRunAt: '2026-05-16T12:30:00Z',
  },
  {
    id: 'cm3',
    slug: 'reindex-search',
    schedule: '@hourly',
    status: 'error',
    lastRunAt: '2026-05-16T11:00:00Z',
    lastRunDurationMs: 4_200,
    nextRunAt: '2026-05-16T12:00:00Z',
  },
];

export const MOCK_UPTIME: readonly UptimeCheckView[] = [
  {
    id: 'u1',
    name: 'homepage',
    url: 'https://example.com/',
    status: 'up',
    uptimePct: 99.99,
    responseTimeMs: 142,
    lastCheckedAt: '2026-05-16T12:00:00Z',
  },
  {
    id: 'u2',
    name: 'api',
    url: 'https://api.example.com/health',
    status: 'degraded',
    uptimePct: 99.5,
    responseTimeMs: 5_400,
    lastCheckedAt: '2026-05-16T12:00:00Z',
  },
  {
    id: 'u3',
    name: 'checkout',
    url: 'https://checkout.example.com/',
    status: 'down',
    uptimePct: 97.1,
    responseTimeMs: 0,
    lastCheckedAt: '2026-05-16T11:59:00Z',
  },
];

export const MOCK_RELEASES: readonly ReleaseView[] = [
  {
    version: 'web@2.14.3',
    deployedAt: '2026-05-16T10:42:00Z',
    environments: ['production', 'staging'],
    commitCount: 14,
    newIssues: 2,
    crashFreeUsers: 99.97,
  },
  {
    version: 'web@2.14.2',
    deployedAt: '2026-05-15T18:11:00Z',
    environments: ['production'],
    commitCount: 7,
    newIssues: 0,
    crashFreeUsers: 99.99,
  },
  {
    version: 'api@1.7.0',
    deployedAt: '2026-05-15T12:00:00Z',
    environments: ['production'],
    commitCount: 22,
    newIssues: 5,
    crashFreeUsers: 99.81,
  },
];