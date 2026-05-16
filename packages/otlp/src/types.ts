/**
 * OTLP v1.x types per OpenTelemetry's `opentelemetry-proto`.
 *
 * Wire-format choices (OTLP/HTTP supports both):
 *
 *   - JSON: camelCase field names, hex-encoded trace/span IDs, AnyValue
 *     fields appear as JSON object discriminated by which `*Value`
 *     property is present. Numeric `*UnixNano` fields are JSON numbers
 *     or strings (decimal); the decoder accepts both.
 *   - Protobuf: snake_case wire field-name encoding decoded externally.
 *     (Not implemented in this first cut; deferred.)
 *
 * These types correspond to the message hierarchy:
 *
 *   ExportTraceServiceRequest
 *     └── ResourceSpans[]
 *           ├── Resource (attributes + droppedAttributesCount)
 *           ├── ScopeSpans[]
 *           │     ├── InstrumentationScope
 *           │     └── Span[]
 *           │           ├── attributes: KeyValue[]
 *           │           ├── events:     Event[]
 *           │           ├── links:      Link[]
 *           │           └── status:     Status
 *           └── schemaUrl
 *
 *   ExportLogsServiceRequest
 *     └── ResourceLogs[]
 *           ├── Resource
 *           ├── ScopeLogs[]
 *           │     ├── InstrumentationScope
 *           │     └── LogRecord[]
 *           └── schemaUrl
 */

export type SpanKind = 0 | 1 | 2 | 3 | 4 | 5;

export const SpanKind = Object.freeze({
  UNSPECIFIED: 0 as SpanKind,
  INTERNAL: 1 as SpanKind,
  SERVER: 2 as SpanKind,
  CLIENT: 3 as SpanKind,
  PRODUCER: 4 as SpanKind,
  CONSUMER: 5 as SpanKind,
});

export type StatusCode = 0 | 1 | 2;

export const StatusCode = Object.freeze({
  UNSET: 0 as StatusCode,
  OK: 1 as StatusCode,
  ERROR: 2 as StatusCode,
});

/** Severity per OTLP §4.1.3. */
export type SeverityNumber = number;

export const SeverityNumber = Object.freeze({
  TRACE: 1,
  TRACE2: 2,
  TRACE3: 3,
  TRACE4: 4,
  DEBUG: 5,
  DEBUG2: 6,
  DEBUG3: 7,
  DEBUG4: 8,
  INFO: 9,
  INFO2: 10,
  INFO3: 11,
  INFO4: 12,
  WARN: 13,
  WARN2: 14,
  WARN3: 15,
  WARN4: 16,
  ERROR: 17,
  ERROR2: 18,
  ERROR3: 19,
  ERROR4: 20,
  FATAL: 21,
  FATAL2: 22,
  FATAL3: 23,
  FATAL4: 24,
});

/** AnyValue discriminated by which property is present. */
export interface AnyValue {
  readonly stringValue?: string;
  readonly boolValue?: boolean;
  readonly intValue?: string | number; // JSON variant: int64 may serialize as string
  readonly doubleValue?: number;
  readonly bytesValue?: string; // base64
  readonly arrayValue?: { readonly values: readonly AnyValue[] };
  readonly kvlistValue?: { readonly values: readonly KeyValue[] };
}

export interface KeyValue {
  readonly key: string;
  readonly value: AnyValue;
}

export interface Resource {
  readonly attributes: readonly KeyValue[];
  readonly droppedAttributesCount?: number;
}

export interface InstrumentationScope {
  readonly name: string;
  readonly version?: string;
  readonly attributes?: readonly KeyValue[];
}

export interface SpanEvent {
  readonly timeUnixNano: string | number;
  readonly name: string;
  readonly attributes?: readonly KeyValue[];
}

export interface SpanLink {
  readonly traceId: string;
  readonly spanId: string;
  readonly attributes?: readonly KeyValue[];
}

export interface SpanStatus {
  readonly code?: StatusCode;
  readonly message?: string;
}

export interface OtlpSpan {
  readonly traceId: string; // 32 hex chars
  readonly spanId: string; // 16 hex chars
  readonly parentSpanId?: string; // 16 hex chars or ''
  readonly name: string;
  readonly kind?: SpanKind;
  readonly startTimeUnixNano: string | number;
  readonly endTimeUnixNano: string | number;
  readonly attributes?: readonly KeyValue[];
  readonly events?: readonly SpanEvent[];
  readonly links?: readonly SpanLink[];
  readonly status?: SpanStatus;
}

export interface ScopeSpans {
  readonly scope: InstrumentationScope;
  readonly spans: readonly OtlpSpan[];
  readonly schemaUrl?: string;
}

export interface ResourceSpans {
  readonly resource: Resource;
  readonly scopeSpans: readonly ScopeSpans[];
  readonly schemaUrl?: string;
}

export interface ExportTraceServiceRequest {
  readonly resourceSpans: readonly ResourceSpans[];
}

export interface OtlpLogRecord {
  readonly timeUnixNano: string | number;
  readonly observedTimeUnixNano?: string | number;
  readonly severityNumber?: SeverityNumber;
  readonly severityText?: string;
  readonly body?: AnyValue;
  readonly attributes?: readonly KeyValue[];
  readonly traceId?: string;
  readonly spanId?: string;
  readonly flags?: number;
}

export interface ScopeLogs {
  readonly scope: InstrumentationScope;
  readonly logRecords: readonly OtlpLogRecord[];
  readonly schemaUrl?: string;
}

export interface ResourceLogs {
  readonly resource: Resource;
  readonly scopeLogs: readonly ScopeLogs[];
  readonly schemaUrl?: string;
}

export interface ExportLogsServiceRequest {
  readonly resourceLogs: readonly ResourceLogs[];
}
