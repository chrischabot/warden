import { describe, expect, test } from 'bun:test';
import { formatSentryTrace, parseSentryTrace, SentryTraceParseError } from '../src/sentry-trace';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';

describe('parseSentryTrace', () => {
  test('without sampled flag', () => {
    const t = parseSentryTrace(`${TRACE}-${SPAN}`);
    expect(t.traceId).toBe(TRACE);
    expect(t.spanId).toBe(SPAN);
    expect(t.sampled).toBeUndefined();
  });

  test('with sampled=1', () => {
    const t = parseSentryTrace(`${TRACE}-${SPAN}-1`);
    expect(t.sampled).toBe(true);
  });

  test('with sampled=0', () => {
    const t = parseSentryTrace(`${TRACE}-${SPAN}-0`);
    expect(t.sampled).toBe(false);
  });

  test('uppercase hex is normalised to lowercase', () => {
    const t = parseSentryTrace(`${TRACE.toUpperCase()}-${SPAN.toUpperCase()}-1`);
    expect(t.traceId).toBe(TRACE);
    expect(t.spanId).toBe(SPAN);
  });

  test('whitespace is trimmed', () => {
    const t = parseSentryTrace(`  ${TRACE}-${SPAN}-1  `);
    expect(t.traceId).toBe(TRACE);
  });
});

describe('parseSentryTrace — invalid', () => {
  test('empty', () => {
    expect(() => parseSentryTrace('')).toThrow(SentryTraceParseError);
  });

  test('wrong trace_id length', () => {
    expect(() => parseSentryTrace(`abcd-${SPAN}`)).toThrow(/trace_id/);
  });

  test('wrong span_id length', () => {
    expect(() => parseSentryTrace(`${TRACE}-abcd`)).toThrow(/span_id/);
  });

  test('invalid sampled', () => {
    expect(() => parseSentryTrace(`${TRACE}-${SPAN}-2`)).toThrow(/sampled flag/);
  });

  test('too many fields', () => {
    expect(() => parseSentryTrace(`${TRACE}-${SPAN}-1-extra`)).toThrow();
  });

  test('non-hex characters', () => {
    expect(() => parseSentryTrace(`${'z'.repeat(32)}-${SPAN}`)).toThrow();
  });
});

describe('formatSentryTrace', () => {
  test('omits sampled when undefined', () => {
    expect(formatSentryTrace({ traceId: TRACE, spanId: SPAN })).toBe(`${TRACE}-${SPAN}`);
  });

  test('emits 1 when sampled=true', () => {
    expect(formatSentryTrace({ traceId: TRACE, spanId: SPAN, sampled: true })).toBe(
      `${TRACE}-${SPAN}-1`,
    );
  });

  test('emits 0 when sampled=false', () => {
    expect(formatSentryTrace({ traceId: TRACE, spanId: SPAN, sampled: false })).toBe(
      `${TRACE}-${SPAN}-0`,
    );
  });
});

describe('round trips', () => {
  test('with sampled', () => {
    const original = { traceId: TRACE, spanId: SPAN, sampled: true } as const;
    expect(parseSentryTrace(formatSentryTrace(original))).toEqual(original);
  });

  test('without sampled', () => {
    const original = { traceId: TRACE, spanId: SPAN } as const;
    expect(parseSentryTrace(formatSentryTrace(original))).toEqual(original);
  });
});
