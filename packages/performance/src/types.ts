/**
 * Performance types — transactions and spans.
 *
 * Spec §5.2 ingests OpenTelemetry-shaped spans alongside Sentry's
 * native Transaction envelope. We model Transaction as the root
 * span of a trace plus aggregate fields (measurements, breakdowns);
 * Spans are child entries within that trace.
 */

export type SpanStatus =
  | 'ok'
  | 'cancelled'
  | 'unknown'
  | 'invalid_argument'
  | 'deadline_exceeded'
  | 'not_found'
  | 'already_exists'
  | 'permission_denied'
  | 'resource_exhausted'
  | 'failed_precondition'
  | 'aborted'
  | 'out_of_range'
  | 'unimplemented'
  | 'internal_error'
  | 'unavailable'
  | 'data_loss'
  | 'unauthenticated';

/** A unit-tagged measurement value: LCP, FCP, CLS, FID, INP, TTFB, etc. */
export interface MeasurementValue {
  readonly value: number;
  readonly unit: string;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly op: string;
  description?: string;
  readonly startTimestamp: number; // ms epoch
  readonly endTimestamp: number;
  /** Convenience: endTimestamp - startTimestamp. */
  readonly durationMs: number;
  status: SpanStatus;
  /** Free-form attributes: db.system, http.method, http.url, etc. */
  data?: Record<string, string | number | boolean | null>;
  tags?: Record<string, string>;
}

export interface Transaction {
  readonly eventId: string;
  readonly projectId: string;
  readonly traceId: string;
  /** Root span id of the transaction. */
  readonly spanId: string;
  readonly transaction: string; // operation name, e.g. "GET /api/users"
  readonly op: string; // root span op, e.g. "http.server"
  readonly platform: string;
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  readonly durationMs: number;
  status: SpanStatus;
  readonly environment?: string;
  readonly release?: string;
  readonly user?: { id?: string; email?: string };
  measurements?: Record<string, MeasurementValue>;
  /** Optional inline child spans. Production stores them columnarly. */
  spans?: readonly Span[];
}

export interface TransactionQuery {
  readonly projectId?: string;
  readonly transactionName?: string;
  readonly op?: string;
  readonly environment?: string;
  readonly release?: string;
  readonly status?: readonly SpanStatus[];
  readonly traceId?: string;
  readonly sinceTimestamp?: number;
  readonly untilTimestamp?: number;
  readonly minDurationMs?: number;
  readonly maxDurationMs?: number;
}

export type TransactionSortField = 'timestamp' | 'duration';
export type SortDir = 'asc' | 'desc';

export interface TransactionListOptions {
  readonly sortBy?: TransactionSortField;
  readonly sortDir?: SortDir;
  readonly limit?: number;
  readonly offset?: number;
}

export interface TransactionListResult {
  readonly transactions: readonly Transaction[];
  readonly total: number;
}
