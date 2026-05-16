/**
 * OTLP logs → Sentry log events.
 *
 * `severityNumber` (OTLP §4.1.3) decimates 1..24 into log levels.
 * `traceId`/`spanId` carry through for trace correlation. Body is
 * flattened to a string (stringValue verbatim; non-string AnyValues
 * JSON-stringified).
 */

import type { LogEvent, LogLevel } from '@sr/logs';
import { attributesToRecord, extractValue, unixNanoToMs } from './decode-json';
import type {
  AnyValue,
  ExportLogsServiceRequest,
  KeyValue,
  OtlpLogRecord,
  ResourceLogs,
} from './types';

export interface ConvertLogOptions {
  readonly projectId: string;
}

export interface ConvertedLogs {
  readonly logs: readonly LogEvent[];
}

let counter = 0;
function nextId(): string {
  counter++;
  return `otlp_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function convertLogsRequest(
  request: ExportLogsServiceRequest,
  options: ConvertLogOptions,
): ConvertedLogs {
  const out: LogEvent[] = [];
  for (const rl of request.resourceLogs) {
    const resourceAttrs = attributesToRecord(rl.resource?.attributes);
    const release = readString(resourceAttrs['service.version']) ?? undefined;
    const environment = readString(resourceAttrs['deployment.environment']) ?? undefined;
    for (const sl of rl.scopeLogs) {
      for (const lr of sl.logRecords) {
        out.push(toLogEvent(lr, options.projectId, release, environment));
      }
    }
  }
  return Object.freeze({ logs: Object.freeze(out) });
}

function toLogEvent(
  lr: OtlpLogRecord,
  projectId: string,
  release: string | undefined,
  environment: string | undefined,
): LogEvent {
  const level = severityToLevel(lr.severityNumber);
  const timestamp = unixNanoToMs(lr.timeUnixNano);
  const message = bodyToString(lr.body);
  const attributes = buildAttributes(lr.attributes);
  return {
    id: nextId(),
    projectId,
    level,
    message,
    timestamp,
    ...(lr.traceId ? { traceId: lr.traceId } : {}),
    ...(lr.spanId ? { spanId: lr.spanId } : {}),
    ...(release !== undefined ? { release } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...(attributes ? { attributes } : {}),
  };
}

function buildAttributes(
  attrs: readonly KeyValue[] | undefined,
):
  | Record<
      string,
      LogEvent['attributes'] extends Readonly<Record<string, infer V>> | undefined ? V : never
    >
  | undefined {
  if (!attrs || attrs.length === 0) return undefined;
  // Project AnyValue scalars onto the LogAttribute type discriminator.
  const out: Record<
    string,
    { type: 'string' | 'integer' | 'double' | 'boolean'; value: string | number | boolean }
  > = {};
  for (const kv of attrs) {
    const v = extractValue(kv.value);
    if (typeof v === 'string') out[kv.key] = { type: 'string', value: v };
    else if (typeof v === 'number') {
      out[kv.key] = Number.isInteger(v)
        ? { type: 'integer', value: v }
        : { type: 'double', value: v };
    } else if (typeof v === 'boolean') {
      out[kv.key] = { type: 'boolean', value: v };
    } else if (v !== undefined) {
      out[kv.key] = { type: 'string', value: JSON.stringify(v) };
    }
  }
  return out as Record<
    string,
    { type: 'string' | 'integer' | 'double' | 'boolean'; value: string | number | boolean }
  >;
}

function bodyToString(body: AnyValue | undefined): string {
  if (!body) return '';
  if (typeof body.stringValue === 'string') return body.stringValue;
  const v = extractValue(body);
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Map OTLP severityNumber [1..24] onto our LogLevel set:
 *
 *   1..4   TRACE  → 'trace'
 *   5..8   DEBUG  → 'debug'
 *   9..12  INFO   → 'info'
 *   13..16 WARN   → 'warning'
 *   17..20 ERROR  → 'error'
 *   21..24 FATAL  → 'fatal'
 *   else          → 'info'
 */
function severityToLevel(severity: number | undefined): LogLevel {
  if (severity === undefined) return 'info';
  if (severity <= 4) return 'trace';
  if (severity <= 8) return 'debug';
  if (severity <= 12) return 'info';
  if (severity <= 16) return 'warning';
  if (severity <= 20) return 'error';
  return 'fatal';
}

function readString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// Re-export extractValue for tests / external consumers.
// Used internally; helps tests assert log-level decimation.
export { extractValue, severityToLevel as _severityToLevel };

// Silence unused-import noise; ResourceLogs imported only for type-clarity.
type _UnusedResourceLogs = ResourceLogs;
