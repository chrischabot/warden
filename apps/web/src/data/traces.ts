import type { WaterfallSpan } from '../components/Waterfall';

export interface TraceSummary {
  readonly id: string;
  readonly rootTransaction: string;
  readonly op: string;
  readonly project: string;
  readonly durationMs: number;
  readonly status: 'ok' | 'error';
  readonly spanCount: number;
  readonly startedAt: string;
  readonly httpStatus?: number;
  readonly user?: string;
  readonly release?: string;
  readonly environment?: string;
}

export interface TraceDetailData {
  readonly summary: TraceSummary;
  readonly spans: readonly WaterfallSpan[];
}

export const MOCK_TRACES: readonly TraceSummary[] = [
  {
    id: 'tr_a1b2c3d4e5f6',
    rootTransaction: 'POST /api/orders',
    op: 'http.server',
    project: 'api',
    durationMs: 942,
    status: 'error',
    spanCount: 12,
    startedAt: '2026-05-16T11:54:32Z',
    httpStatus: 500,
    user: 'u-204',
    release: 'api@1.7.0',
    environment: 'production',
  },
  {
    id: 'tr_b2c3d4e5f6a1',
    rootTransaction: 'GET /api/users',
    op: 'http.server',
    project: 'api',
    durationMs: 38,
    status: 'ok',
    spanCount: 4,
    startedAt: '2026-05-16T11:54:30Z',
    httpStatus: 200,
    release: 'api@1.7.0',
    environment: 'production',
  },
  {
    id: 'tr_c3d4e5f6a1b2',
    rootTransaction: 'GET /dashboard',
    op: 'pageload',
    project: 'web',
    durationMs: 1820,
    status: 'ok',
    spanCount: 21,
    startedAt: '2026-05-16T11:54:18Z',
    release: 'web@2.14.3',
    environment: 'production',
  },
  {
    id: 'tr_d4e5f6a1b2c3',
    rootTransaction: 'sync.shippingProvider',
    op: 'queue.process',
    project: 'worker',
    durationMs: 5840,
    status: 'error',
    spanCount: 8,
    startedAt: '2026-05-16T11:54:01Z',
    user: 'u-77',
    environment: 'production',
  },
  {
    id: 'tr_e5f6a1b2c3d4',
    rootTransaction: 'GET /api/feed',
    op: 'http.server',
    project: 'api',
    durationMs: 142,
    status: 'ok',
    spanCount: 9,
    startedAt: '2026-05-16T11:53:51Z',
    httpStatus: 200,
    environment: 'production',
  },
];

const TRACE_DETAILS: Readonly<Record<string, TraceDetailData>> = {
  tr_a1b2c3d4e5f6: {
    summary: MOCK_TRACES[0] as TraceSummary,
    spans: [
      { id: 's0', op: 'http.server', description: 'POST /api/orders', startMs: 0, durationMs: 942, status: 'error' },
      { id: 's1', parentId: 's0', op: 'function', description: 'validate.body', startMs: 2, durationMs: 6 },
      { id: 's2', parentId: 's0', op: 'db', description: 'SELECT users WHERE id = ?', startMs: 12, durationMs: 18 },
      { id: 's3', parentId: 's0', op: 'db', description: 'INSERT orders', startMs: 36, durationMs: 32 },
      { id: 's4', parentId: 's3', op: 'db', description: 'INSERT order_items', startMs: 42, durationMs: 14 },
      { id: 's5', parentId: 's0', op: 'http.client', description: 'POST payments.example.com', startMs: 80, durationMs: 612, status: 'slow' },
      { id: 's6', parentId: 's5', op: 'function', description: 'serialize.payload', startMs: 82, durationMs: 4 },
      { id: 's7', parentId: 's0', op: 'queue', description: 'publish order.created', startMs: 700, durationMs: 28 },
      { id: 's8', parentId: 's0', op: 'db', description: 'UPDATE inventory', startMs: 740, durationMs: 84 },
      { id: 's9', parentId: 's0', op: 'http.client', description: 'POST analytics.example.com', startMs: 830, durationMs: 92 },
      { id: 's10', parentId: 's0', op: 'function', description: 'render.response', startMs: 930, durationMs: 10 },
      { id: 's11', parentId: 's5', op: 'function', description: 'parse.response', startMs: 690, durationMs: 2, status: 'error' },
    ],
  },
};

export function getTraceDetail(id: string): TraceDetailData | undefined {
  return TRACE_DETAILS[id] ?? (MOCK_TRACES.find((t) => t.id === id) && {
    summary: MOCK_TRACES.find((t) => t.id === id) as TraceSummary,
    // Synthesize a small waterfall for any other trace.
    spans: synthesize(id),
  });
}

function synthesize(seed: string): WaterfallSpan[] {
  const h = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const dur = 50 + (h % 800);
  const spans: WaterfallSpan[] = [
    { id: 's0', op: 'http.server', description: 'root', startMs: 0, durationMs: dur },
  ];
  let off = 5;
  for (let i = 1; i <= 5; i++) {
    spans.push({
      id: `s${i}`,
      parentId: 's0',
      op: i % 2 === 0 ? 'db' : 'http.client',
      description: `child ${i}`,
      startMs: off,
      durationMs: 5 + (h % 80),
    });
    off += 5 + (h % 80) + 4;
  }
  return spans;
}