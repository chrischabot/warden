import { describe, expect, test } from 'bun:test';
import { convertTraceRequest } from '../src/convert-traces';
import type { ExportTraceServiceRequest, OtlpSpan } from '../src/types';
import { SpanKind, StatusCode } from '../src/types';

function nsString(ms: number): string {
  return String(ms * 1_000_000);
}

function span(overrides: Partial<OtlpSpan>): OtlpSpan {
  return {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    spanId: 'bbbbbbbbbbbbbbbb',
    name: 'span',
    startTimeUnixNano: nsString(1000),
    endTimeUnixNano: nsString(1500),
    ...overrides,
  };
}

function request(
  spans: OtlpSpan[],
  resourceAttrs: Record<string, string> = {},
): ExportTraceServiceRequest {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: Object.entries(resourceAttrs).map(([key, value]) => ({
            key,
            value: { stringValue: value },
          })),
        },
        scopeSpans: [
          {
            scope: { name: 'test-scope' },
            spans,
          },
        ],
      },
    ],
  };
}

describe('convertTraceRequest — single root span', () => {
  test('root span becomes a Transaction', () => {
    const r = convertTraceRequest(
      request([
        span({
          name: 'GET /api/users',
          kind: SpanKind.SERVER,
          attributes: [{ key: 'http.route', value: { stringValue: '/api/users' } }],
          status: { code: StatusCode.OK },
        }),
      ]),
      { projectId: '1' },
    );
    expect(r.transactions.length).toBe(1);
    const tx = r.transactions[0]!;
    expect(tx.op).toBe('http.server');
    expect(tx.transaction).toBe('/api/users'); // from http.route attribute
    expect(tx.status).toBe('ok');
    expect(tx.durationMs).toBe(500);
    expect(tx.startTimestamp).toBe(1000);
    expect(tx.endTimestamp).toBe(1500);
    expect(tx.spans).toEqual([]);
  });

  test('falls back to span.name when no http.route', () => {
    const r = convertTraceRequest(request([span({ name: 'background-job' })]), { projectId: '1' });
    expect(r.transactions[0]?.transaction).toBe('background-job');
  });

  test('status ERROR maps to internal_error', () => {
    const r = convertTraceRequest(
      request([span({ status: { code: StatusCode.ERROR, message: 'boom' } })]),
      { projectId: '1' },
    );
    expect(r.transactions[0]?.status).toBe('internal_error');
  });

  test('UNSET status maps to unknown', () => {
    const r = convertTraceRequest(request([span({})]), { projectId: '1' });
    expect(r.transactions[0]?.status).toBe('unknown');
  });
});

describe('convertTraceRequest — span kinds', () => {
  test.each([
    [SpanKind.SERVER, 'http.server'],
    [SpanKind.CLIENT, 'http.client'],
    [SpanKind.PRODUCER, 'queue.publish'],
    [SpanKind.CONSUMER, 'queue.process'],
    [SpanKind.INTERNAL, 'function'],
    [SpanKind.UNSPECIFIED, 'operation'],
  ])('kind=%s → op=%s', (kind, op) => {
    const r = convertTraceRequest(request([span({ kind })]), { projectId: '1' });
    expect(r.transactions[0]?.op).toBe(op);
  });
});

describe('convertTraceRequest — tree of spans', () => {
  test('child spans attach to their root transaction', () => {
    const root: OtlpSpan = span({
      spanId: '1111111111111111',
      name: 'root',
      kind: SpanKind.SERVER,
    });
    const child1: OtlpSpan = span({
      spanId: '2222222222222222',
      parentSpanId: '1111111111111111',
      name: 'SELECT users',
      kind: SpanKind.CLIENT,
      startTimeUnixNano: nsString(1100),
      endTimeUnixNano: nsString(1200),
    });
    const child2: OtlpSpan = span({
      spanId: '3333333333333333',
      parentSpanId: '2222222222222222',
      name: 'deserialize',
      kind: SpanKind.INTERNAL,
      startTimeUnixNano: nsString(1210),
      endTimeUnixNano: nsString(1250),
    });
    const r = convertTraceRequest(request([root, child1, child2]), { projectId: '1' });
    expect(r.transactions.length).toBe(1);
    const tx = r.transactions[0]!;
    expect(tx.spans?.length).toBe(2);
    const child1Out = tx.spans?.find((s) => s.spanId === '2222222222222222');
    expect(child1Out?.description).toBe('SELECT users');
    expect(child1Out?.parentSpanId).toBe('1111111111111111');
    const child2Out = tx.spans?.find((s) => s.spanId === '3333333333333333');
    expect(child2Out?.parentSpanId).toBe('2222222222222222');
  });

  test('orphan parent (parent_span_id not in payload) treats span as a root', () => {
    const orphan = span({ spanId: 'cccccccccccccccc', parentSpanId: 'not-in-batch' });
    const r = convertTraceRequest(request([orphan]), { projectId: '1' });
    expect(r.transactions.length).toBe(1);
  });

  test('two separate roots produce two transactions', () => {
    const r = convertTraceRequest(
      request([
        span({ spanId: '1111111111111111', name: 'root-a' }),
        span({ spanId: '2222222222222222', name: 'root-b' }),
      ]),
      { projectId: '1' },
    );
    expect(r.transactions.length).toBe(2);
  });
});

describe('convertTraceRequest — resource propagation', () => {
  test('extracts release + environment + platform from resource attributes', () => {
    const r = convertTraceRequest(
      request([span({})], {
        'service.version': '1.4.2',
        'deployment.environment': 'prod',
        'telemetry.sdk.language': 'go',
      }),
      { projectId: '1' },
    );
    const tx = r.transactions[0]!;
    expect(tx.release).toBe('1.4.2');
    expect(tx.environment).toBe('prod');
    expect(tx.platform).toBe('go');
  });

  test('defaultPlatform applies when no telemetry.sdk.language attribute', () => {
    const r = convertTraceRequest(request([span({})]), {
      projectId: '1',
      defaultPlatform: 'javascript',
    });
    expect(r.transactions[0]?.platform).toBe('javascript');
  });
});

describe('convertTraceRequest — span attributes', () => {
  test('child span data includes attributes + scope.* + resource.*', () => {
    const root = span({ spanId: 'aaaaaaaaaaaaaaaa', name: 'root' });
    const child = span({
      spanId: 'bbbbbbbbbbbbbbbb',
      parentSpanId: 'aaaaaaaaaaaaaaaa',
      name: 'child',
      attributes: [
        { key: 'db.system', value: { stringValue: 'postgresql' } },
        { key: 'db.rows', value: { intValue: '42' } },
      ],
    });
    const r = convertTraceRequest(request([root, child], { 'service.name': 'web' }), {
      projectId: '1',
    });
    const childOut = r.transactions[0]?.spans?.[0];
    expect(childOut?.data?.['db.system']).toBe('postgresql');
    expect(childOut?.data?.['db.rows']).toBe(42);
    expect(childOut?.data?.['resource.service.name']).toBe('web');
  });
});
