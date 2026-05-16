import { describe, expect, test } from 'bun:test';
import { parseBaggage } from '../src/baggage';
import { extractTraceContext, injectTraceContext } from '../src/trace-context';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';

describe('extractTraceContext — preference order', () => {
  test('prefers traceparent over sentry-trace', () => {
    const ctx = extractTraceContext({
      traceparent: `00-${TRACE}-${SPAN}-01`,
      'sentry-trace': `${'a'.repeat(32)}-${'b'.repeat(16)}-0`,
    });
    expect(ctx?.traceId).toBe(TRACE);
    expect(ctx?.spanId).toBe(SPAN);
    expect(ctx?.sampled).toBe(true);
  });

  test('falls back to sentry-trace when traceparent absent', () => {
    const ctx = extractTraceContext({
      'sentry-trace': `${TRACE}-${SPAN}-1`,
    });
    expect(ctx?.traceId).toBe(TRACE);
    expect(ctx?.spanId).toBe(SPAN);
    expect(ctx?.sampled).toBe(true);
  });

  test('falls back to sentry-trace when traceparent malformed', () => {
    const ctx = extractTraceContext({
      traceparent: 'totally invalid',
      'sentry-trace': `${TRACE}-${SPAN}`,
    });
    expect(ctx?.traceId).toBe(TRACE);
    expect(ctx?.sampled).toBeUndefined();
  });

  test('returns undefined when nothing is present', () => {
    expect(extractTraceContext({})).toBeUndefined();
  });

  test('returns undefined when all headers are malformed', () => {
    const ctx = extractTraceContext({
      traceparent: 'bad',
      'sentry-trace': 'bad',
    });
    expect(ctx).toBeUndefined();
  });

  test('attaches baggage when provided', () => {
    const ctx = extractTraceContext({
      'sentry-trace': `${TRACE}-${SPAN}-1`,
      baggage: 'sentry-environment=prod,sentry-release=v1',
    });
    expect(ctx?.baggage?.sentry).toEqual({ environment: 'prod', release: 'v1' });
  });
});

describe('injectTraceContext', () => {
  test('always emits sentry-trace, omits traceparent by default', () => {
    const h = injectTraceContext({ traceId: TRACE, spanId: SPAN, sampled: true });
    expect(h['sentry-trace']).toBe(`${TRACE}-${SPAN}-1`);
    expect(h['traceparent']).toBeUndefined();
  });

  test('emits traceparent when opted in', () => {
    const h = injectTraceContext(
      { traceId: TRACE, spanId: SPAN, sampled: true },
      { traceparent: true },
    );
    expect(h['traceparent']).toBe(`00-${TRACE}-${SPAN}-01`);
  });

  test('traceparent flags reflect sampled=false', () => {
    const h = injectTraceContext(
      { traceId: TRACE, spanId: SPAN, sampled: false },
      { traceparent: true },
    );
    expect(h['traceparent']).toBe(`00-${TRACE}-${SPAN}-00`);
  });

  test('round trip preserves trace_id and span_id', () => {
    const ctx = { traceId: TRACE, spanId: SPAN, sampled: true } as const;
    const headers = injectTraceContext(ctx, { traceparent: true });
    const extracted = extractTraceContext(headers);
    expect(extracted?.traceId).toBe(TRACE);
    expect(extracted?.spanId).toBe(SPAN);
    expect(extracted?.sampled).toBe(true);
  });
});

describe('injectTraceContext — baggage', () => {
  test('emits baggage when context carries it', () => {
    const baggage = parseBaggage('sentry-environment=prod,sentry-release=v1,vendor-x=y');
    const headers = injectTraceContext({
      traceId: TRACE,
      spanId: SPAN,
      sampled: true,
      baggage,
    });
    expect(headers.baggage).toBeDefined();
    const reparsed = parseBaggage(headers.baggage as string);
    expect(reparsed.sentry).toEqual({ environment: 'prod', release: 'v1' });
    expect(reparsed.thirdParty).toEqual([['vendor-x', 'y']]);
  });

  test('omits baggage when context has none', () => {
    const headers = injectTraceContext({ traceId: TRACE, spanId: SPAN });
    expect(headers.baggage).toBeUndefined();
  });

  test('omits baggage when context baggage is empty', () => {
    const headers = injectTraceContext({
      traceId: TRACE,
      spanId: SPAN,
      baggage: parseBaggage(''),
    });
    expect(headers.baggage).toBeUndefined();
  });

  test('full round trip preserves baggage', () => {
    const baggage = parseBaggage('sentry-environment=prod,sentry-release=v2,vendor-id=42');
    const headers = injectTraceContext(
      { traceId: TRACE, spanId: SPAN, sampled: true, baggage },
      { traceparent: true },
    );
    const extracted = extractTraceContext(headers);
    expect(extracted?.baggage?.sentry).toEqual({ environment: 'prod', release: 'v2' });
    expect(extracted?.baggage?.thirdParty).toEqual([['vendor-id', '42']]);
  });
});
