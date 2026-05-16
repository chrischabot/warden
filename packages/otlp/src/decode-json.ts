/**
 * OTLP/JSON decoder.
 *
 * Decodes `ExportTraceServiceRequest` and `ExportLogsServiceRequest`
 * payloads from bytes or strings. Tolerates the int64-as-string
 * representation OTLP/JSON uses for nanoseconds.
 *
 * `extractValue(any)` reduces an AnyValue to the closest plain
 * JavaScript value. `attributesToRecord` flattens a KeyValue list
 * to a string-keyed record (later code-paths assume KV maps).
 */

import type {
  AnyValue,
  ExportLogsServiceRequest,
  ExportTraceServiceRequest,
  KeyValue,
} from './types';

export class OtlpDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtlpDecodeError';
  }
}

/** Decode a trace export request from JSON bytes or string. */
export function decodeTraceRequest(input: Uint8Array | string): ExportTraceServiceRequest {
  return parse(input) as ExportTraceServiceRequest;
}

/** Decode a logs export request from JSON bytes or string. */
export function decodeLogsRequest(input: Uint8Array | string): ExportLogsServiceRequest {
  return parse(input) as ExportLogsServiceRequest;
}

function parse(input: Uint8Array | string): unknown {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8').decode(input);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new OtlpDecodeError(`invalid JSON: ${(e as Error).message}`);
  }
}

/**
 * Convert an AnyValue to a primitive / array / object suitable for
 * use in Sentry attributes. Returns `undefined` for an empty AnyValue.
 */
export function extractValue(value: AnyValue | undefined): unknown {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue) return value.arrayValue.values.map(extractValue);
  if (value.kvlistValue) {
    const out: Record<string, unknown> = {};
    for (const kv of value.kvlistValue.values) out[kv.key] = extractValue(kv.value);
    return out;
  }
  return undefined;
}

/** Flatten a KeyValue list into a string-keyed record. */
export function attributesToRecord(
  attrs: readonly KeyValue[] | undefined,
): Record<string, unknown> {
  if (!attrs) return {};
  const out: Record<string, unknown> = {};
  for (const kv of attrs) out[kv.key] = extractValue(kv.value);
  return out;
}

/** Parse a `*UnixNano` field (string-or-number) to ms epoch as a Number. */
export function unixNanoToMs(input: string | number | undefined): number {
  if (input === undefined) return 0;
  if (typeof input === 'number') return Math.floor(input / 1_000_000);
  // BigInt path for string nano values to preserve precision.
  try {
    const big = BigInt(input);
    const ms = big / 1_000_000n;
    return Number(ms);
  } catch {
    const n = Number(input);
    return Number.isFinite(n) ? Math.floor(n / 1_000_000) : 0;
  }
}
