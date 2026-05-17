import type { FlameNode } from '../components/Flamegraph';

export interface ProfileSummary {
  readonly id: string;
  readonly transaction: string;
  readonly project: string;
  readonly platform: string;
  readonly durationMs: number;
  readonly samples: number;
  readonly capturedAt: string;
}

export const MOCK_PROFILES: readonly ProfileSummary[] = [
  {
    id: 'prof_001',
    transaction: 'POST /api/orders',
    project: 'api',
    platform: 'node',
    durationMs: 942,
    samples: 96,
    capturedAt: '2026-05-16T11:54:32Z',
  },
  {
    id: 'prof_002',
    transaction: 'GET /dashboard',
    project: 'web',
    platform: 'javascript',
    durationMs: 1820,
    samples: 184,
    capturedAt: '2026-05-16T11:54:18Z',
  },
  {
    id: 'prof_003',
    transaction: 'sync.shippingProvider',
    project: 'worker',
    platform: 'python',
    durationMs: 5840,
    samples: 590,
    capturedAt: '2026-05-16T11:54:01Z',
  },
];

const FLAMES: Readonly<Record<string, FlameNode>> = {
  prof_001: {
    name: 'root',
    self: 4,
    total: 942,
    children: [
      {
        name: 'validate.body',
        self: 6,
        total: 6,
      },
      {
        name: 'orders.create',
        self: 12,
        total: 880,
        children: [
          { name: 'db.select.users', self: 18, total: 18 },
          {
            name: 'payments.charge',
            self: 14,
            total: 612,
            children: [
              { name: 'json.serialize', self: 4, total: 4 },
              { name: 'http.client', self: 594, total: 594 },
            ],
          },
          { name: 'db.insert.orders', self: 32, total: 32 },
          { name: 'db.update.inventory', self: 84, total: 84 },
          {
            name: 'queue.publish',
            self: 28,
            total: 28,
          },
        ],
      },
      { name: 'render.response', self: 10, total: 10 },
      { name: 'metrics.record', self: 42, total: 42 },
    ],
  },
  prof_002: {
    name: 'root',
    self: 60,
    total: 1820,
    children: [
      { name: 'render.app', self: 240, total: 880, children: [
        { name: 'render.header', self: 80, total: 80 },
        { name: 'render.body', self: 200, total: 560, children: [
          { name: 'fetch.users', self: 320, total: 320 },
          { name: 'render.list', self: 40, total: 40 },
        ]},
      ]},
      { name: 'hydrate', self: 180, total: 380, children: [
        { name: 'reconcile', self: 200, total: 200 },
      ]},
      { name: 'idle.tasks', self: 500, total: 500 },
    ],
  },
  prof_003: {
    name: 'root',
    self: 80,
    total: 5840,
    children: [
      { name: 'fetch.shipments', self: 1200, total: 1200 },
      { name: 'compute.routes', self: 2400, total: 2900, children: [
        { name: 'graph.dijkstra', self: 500, total: 500 },
      ]},
      { name: 'persist', self: 1660, total: 1660 },
    ],
  },
};

export function getFlame(profileId: string): FlameNode | undefined {
  return FLAMES[profileId];
}