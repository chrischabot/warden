/**
 * `sentry-trace` header codec.
 *
 * Format: `<trace_id>-<span_id>[-<sampled>]`
 *   trace_id: 32 hex chars (16 bytes)
 *   span_id:  16 hex chars (8 bytes)
 *   sampled:  '0' or '1' (optional)
 */

export interface SentryTrace {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled?: boolean;
}

const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_16 = /^[0-9a-f]{16}$/;

export class SentryTraceParseError extends Error {
  public readonly input: string;
  constructor(message: string, input: string) {
    super(message);
    this.name = 'SentryTraceParseError';
    this.input = input;
  }
}

export function parseSentryTrace(input: string): SentryTrace {
  if (typeof input !== 'string' || input.length === 0) {
    throw new SentryTraceParseError('sentry-trace must be a non-empty string', String(input));
  }
  const parts = input.trim().toLowerCase().split('-');
  if (parts.length < 2 || parts.length > 3) {
    throw new SentryTraceParseError(
      `sentry-trace must have 2 or 3 dash-separated fields, got ${parts.length}`,
      input,
    );
  }
  const traceId = parts[0] as string;
  const spanId = parts[1] as string;
  const sampledRaw = parts[2];
  if (!HEX_32.test(traceId)) {
    throw new SentryTraceParseError(`invalid trace_id: "${traceId}"`, input);
  }
  if (!HEX_16.test(spanId)) {
    throw new SentryTraceParseError(`invalid span_id: "${spanId}"`, input);
  }
  let sampled: boolean | undefined;
  if (sampledRaw !== undefined) {
    if (sampledRaw === '0') sampled = false;
    else if (sampledRaw === '1') sampled = true;
    else throw new SentryTraceParseError(`invalid sampled flag: "${sampledRaw}"`, input);
  }
  return Object.freeze({
    traceId,
    spanId,
    ...(sampled !== undefined ? { sampled } : {}),
  });
}

export function formatSentryTrace(t: SentryTrace): string {
  const base = `${t.traceId}-${t.spanId}`;
  if (t.sampled === undefined) return base;
  return `${base}-${t.sampled ? '1' : '0'}`;
}
