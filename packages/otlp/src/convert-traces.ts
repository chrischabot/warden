/**
 * OTLP traces → Sentry transactions/spans.
 *
 * A root span (no parentSpanId, or empty parentSpanId) maps to a
 * Sentry `Transaction`. Non-root spans map to a Sentry child
 * `Span`. The transaction's child-span set is the union of its
 * own descendants within the same `ResourceSpans` / `ScopeSpans`.
 *
 * Resource attributes propagate into every span's `data` map under
 * a `resource.` prefix; scope attributes prepend `scope.`.
 *
 * SpanKind → Sentry `op` mapping (matching what the OpenTelemetry
 * SDK for Sentry uses):
 *
 *   SERVER   → http.server
 *   CLIENT   → http.client
 *   PRODUCER → queue.publish
 *   CONSUMER → queue.process
 *   INTERNAL → function
 *   UNSPECIFIED / unknown → operation
 */

import type {
  Span as SentrySpan,
  SpanStatus as SentrySpanStatus,
  Transaction,
} from '@sr/performance';
import { attributesToRecord, extractValue, unixNanoToMs } from './decode-json';
import type {
  ExportTraceServiceRequest,
  OtlpSpan,
  SpanKind as OtlpSpanKind,
  Resource,
  ResourceSpans,
  ScopeSpans,
} from './types';
import { SpanKind, StatusCode } from './types';

export interface ConvertOptions {
  /** Project ID stamped on the resulting transactions. */
  readonly projectId: string;
  /** Fallback platform if `telemetry.sdk.language` isn't on the resource. */
  readonly defaultPlatform?: string;
}

export interface ConvertedTrace {
  readonly transactions: readonly Transaction[];
  readonly orphanSpans: readonly SentrySpan[];
}

export function convertTraceRequest(
  request: ExportTraceServiceRequest,
  options: ConvertOptions,
): ConvertedTrace {
  const transactions: Transaction[] = [];
  const orphanSpans: SentrySpan[] = [];

  for (const rs of request.resourceSpans) {
    const resourceAttrs = attributesToRecord(rs.resource?.attributes);
    const platform =
      readString(resourceAttrs['telemetry.sdk.language']) ?? options.defaultPlatform ?? 'unknown';
    const release = readString(resourceAttrs['service.version']);
    const environment = readString(resourceAttrs['deployment.environment']);

    for (const ss of rs.scopeSpans) {
      const scopeAttrs = attributesToRecord(ss.scope?.attributes);
      const spansById = new Map<string, OtlpSpan>();
      for (const s of ss.spans) spansById.set(s.spanId, s);

      // Group spans by transaction root.
      const root = (s: OtlpSpan): OtlpSpan => {
        let cur = s;
        while (cur.parentSpanId && spansById.has(cur.parentSpanId)) {
          const next = spansById.get(cur.parentSpanId);
          if (!next || next === cur) break;
          cur = next;
        }
        return cur;
      };
      const txGroups = new Map<string, OtlpSpan[]>();
      for (const s of ss.spans) {
        const r = root(s);
        const arr = txGroups.get(r.spanId) ?? [];
        arr.push(s);
        txGroups.set(r.spanId, arr);
      }

      for (const [rootSpanId, spans] of txGroups.entries()) {
        const rootSpan = spans.find((s) => s.spanId === rootSpanId);
        if (!rootSpan) continue;
        const sentryRoot = otlpToTransaction(rootSpan, rs.resource, {
          projectId: options.projectId,
          platform,
          ...(release !== undefined ? { release } : {}),
          ...(environment !== undefined ? { environment } : {}),
          scopeAttrs,
          resourceAttrs,
        });
        const childSpans: SentrySpan[] = [];
        for (const s of spans) {
          if (s.spanId === rootSpanId) continue;
          childSpans.push(otlpToSpan(s, scopeAttrs, resourceAttrs));
        }
        transactions.push({ ...sentryRoot, spans: childSpans });
      }
    }
  }
  return Object.freeze({
    transactions: Object.freeze(transactions),
    orphanSpans: Object.freeze(orphanSpans),
  });
}

interface RootMeta {
  readonly projectId: string;
  readonly platform: string;
  readonly release?: string;
  readonly environment?: string;
  readonly scopeAttrs: Record<string, unknown>;
  readonly resourceAttrs: Record<string, unknown>;
}

function otlpToTransaction(s: OtlpSpan, resource: Resource, meta: RootMeta): Transaction {
  const start = unixNanoToMs(s.startTimeUnixNano);
  const end = unixNanoToMs(s.endTimeUnixNano);
  const attrs = attributesToRecord(s.attributes);
  const status = mapStatus(s);
  const txName =
    readString(attrs['http.route']) ??
    readString(attrs['http.target']) ??
    readString(attrs['rpc.method']) ??
    s.name;
  return {
    eventId: hexEventId(s.traceId, s.spanId),
    projectId: meta.projectId,
    traceId: s.traceId,
    spanId: s.spanId,
    transaction: txName,
    op: opFor(s.kind),
    platform: meta.platform,
    startTimestamp: start,
    endTimestamp: end,
    durationMs: Math.max(0, end - start),
    status,
    ...(meta.environment !== undefined ? { environment: meta.environment } : {}),
    ...(meta.release !== undefined ? { release: meta.release } : {}),
  };
}

function otlpToSpan(
  s: OtlpSpan,
  scopeAttrs: Record<string, unknown>,
  resourceAttrs: Record<string, unknown>,
): SentrySpan {
  const start = unixNanoToMs(s.startTimeUnixNano);
  const end = unixNanoToMs(s.endTimeUnixNano);
  const data: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(attributesToRecord(s.attributes))) {
    data[k] = coerceScalar(v);
  }
  for (const [k, v] of Object.entries(scopeAttrs)) {
    data[`scope.${k}`] = coerceScalar(v);
  }
  for (const [k, v] of Object.entries(resourceAttrs)) {
    data[`resource.${k}`] = coerceScalar(v);
  }
  return {
    traceId: s.traceId,
    spanId: s.spanId,
    ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
    op: opFor(s.kind),
    description: s.name,
    startTimestamp: start,
    endTimestamp: end,
    durationMs: Math.max(0, end - start),
    status: mapStatus(s),
    data,
  };
}

function mapStatus(s: OtlpSpan): SentrySpanStatus {
  const code = s.status?.code ?? StatusCode.UNSET;
  if (code === StatusCode.OK) return 'ok';
  if (code === StatusCode.ERROR) return 'internal_error';
  return 'unknown';
}

function opFor(kind: OtlpSpanKind | undefined): string {
  switch (kind) {
    case SpanKind.SERVER:
      return 'http.server';
    case SpanKind.CLIENT:
      return 'http.client';
    case SpanKind.PRODUCER:
      return 'queue.publish';
    case SpanKind.CONSUMER:
      return 'queue.process';
    case SpanKind.INTERNAL:
      return 'function';
    default:
      return 'operation';
  }
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function coerceScalar(v: unknown): string | number | boolean | null {
  if (v === null) return null;
  switch (typeof v) {
    case 'string':
    case 'number':
    case 'boolean':
      return v;
    default:
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
  }
}

function hexEventId(traceId: string, spanId: string): string {
  // Sentry event IDs are 32-char lowercase hex.
  // Derive deterministically from traceId so reprocessing is idempotent.
  const combined = `${traceId}${spanId}`.toLowerCase();
  if (combined.length >= 32) return combined.slice(0, 32);
  return combined.padEnd(32, '0');
}

// Re-export extractValue for tests / external consumers.
export { extractValue };
