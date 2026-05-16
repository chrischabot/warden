/**
 * Unified trace-context construction and propagation.
 *
 * Spec §6 mandates each SDK can emit and accept any of
 * `sentry-trace`, `baggage`, `traceparent`. This module is the
 * single place those three are reconciled.
 *
 * Extract preference order: traceparent → sentry-trace.
 * Inject: always sentry-trace; baggage when DSC is present;
 * traceparent only when `options.traceparent === true` (matching
 * the SDK's documented `propagateTraceparent` opt-in).
 */

import type { Baggage } from './baggage';
import { formatBaggage, parseBaggage } from './baggage';
import { formatSentryTrace, parseSentryTrace } from './sentry-trace';
import { formatTraceparent, parseTraceparent } from './traceparent';

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled?: boolean;
  readonly baggage?: Baggage;
}

export interface PropagationHeaders {
  readonly 'sentry-trace'?: string;
  readonly baggage?: string;
  readonly traceparent?: string;
}

/** Extract trace context from incoming headers; returns undefined if none present. */
export function extractTraceContext(headers: PropagationHeaders): TraceContext | undefined {
  let baggage: Baggage | undefined;
  if (headers.baggage) {
    try {
      baggage = parseBaggage(headers.baggage);
    } catch {
      // ignore malformed baggage
    }
  }

  if (headers.traceparent) {
    try {
      const tp = parseTraceparent(headers.traceparent);
      return Object.freeze({
        traceId: tp.traceId,
        spanId: tp.parentId,
        sampled: tp.sampled,
        ...(baggage ? { baggage } : {}),
      });
    } catch {
      // fall through to sentry-trace
    }
  }

  if (headers['sentry-trace']) {
    try {
      const st = parseSentryTrace(headers['sentry-trace']);
      return Object.freeze({
        traceId: st.traceId,
        spanId: st.spanId,
        ...(st.sampled !== undefined ? { sampled: st.sampled } : {}),
        ...(baggage ? { baggage } : {}),
      });
    } catch {
      // ignore
    }
  }

  return undefined;
}

export interface InjectOptions {
  /** Also emit a `traceparent` header. SDK opt-in flag. */
  traceparent?: boolean;
}

/** Construct outgoing propagation headers for a trace context. */
export function injectTraceContext(
  ctx: TraceContext,
  options: InjectOptions = {},
): PropagationHeaders {
  const out: Record<string, string> = {};
  out['sentry-trace'] = formatSentryTrace({
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    ...(ctx.sampled !== undefined ? { sampled: ctx.sampled } : {}),
  });
  if (ctx.baggage) {
    const formatted = formatBaggage(ctx.baggage);
    if (formatted.length > 0) {
      out['baggage'] = formatted;
    }
  }
  if (options.traceparent) {
    out['traceparent'] = formatTraceparent({
      version: 0,
      traceId: ctx.traceId,
      parentId: ctx.spanId,
      flags: ctx.sampled === true ? 0x01 : 0x00,
      sampled: ctx.sampled === true,
    });
  }
  return Object.freeze(out);
}
