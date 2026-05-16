/**
 * Envelope Item type discriminators per the Sentry envelope spec.
 * Each Item is `{ header, payload }` where payload is a Uint8Array
 * of either a single JSON-encoded line or `length` bytes of
 * arbitrary binary content.
 *
 * We do not strictly validate type-specific fields here; the relay
 * and ingest workers do that against per-type schemas. This module
 * defines only the discriminator and the common envelope shape.
 */

export type ItemType =
  | 'event'
  | 'transaction'
  | 'attachment'
  | 'session'
  | 'sessions'
  | 'user_report'
  | 'feedback'
  | 'client_report'
  | 'replay_event'
  | 'replay_recording'
  | 'profile'
  | 'profile_chunk'
  | 'check_in'
  | 'statsd'
  | 'log'
  | 'otel_log'
  | 'otel_span';

export interface ItemHeader {
  /** Discriminator. */
  type: ItemType | string;
  /** Byte length of the payload; required for binary payloads. */
  length?: number;
  /** MIME-style content type; defaults are type-specific. */
  content_type?: string;
  /** Filename for attachments. */
  filename?: string;
  /** Pass-through for type-specific headers. */
  [key: string]: unknown;
}

export interface Item {
  readonly header: ItemHeader;
  readonly payload: Uint8Array;
}

/** Dynamic-Sampling Context inlined into envelope headers. */
export interface DynamicSamplingContext {
  trace_id: string;
  public_key: string;
  environment?: string;
  release?: string;
  transaction?: string;
  sample_rate?: string | number;
  sampled?: string | boolean;
  user_id?: string;
}

export interface EnvelopeHeader {
  event_id?: string;
  /** ISO 8601 timestamp. */
  sent_at?: string;
  /** DSN as string; deprecated in favour of auth headers but still accepted. */
  dsn?: string;
  sdk?: { name: string; version: string };
  trace?: DynamicSamplingContext;
  [key: string]: unknown;
}
