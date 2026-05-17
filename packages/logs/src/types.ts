/**
 * Log types per spec §5.10.
 *
 * `LogLevel` follows the syslog tradition reduced to the Sentry
 * level set; `trace` is included for spans/traces (lowest severity).
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

export interface LogAttribute {
  readonly type: 'string' | 'integer' | 'double' | 'boolean';
  readonly value: string | number | boolean;
}

export interface LogEvent {
  readonly id: string;
  readonly projectId: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: number;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly release?: string;
  readonly environment?: string;
  /** Structured attributes — typed per OTLP `log_record.attributes`. */
  readonly attributes?: Readonly<Record<string, LogAttribute>>;
  readonly tags?: Readonly<Record<string, string>>;
}

export interface LogQuery {
  readonly projectId?: string;
  readonly minLevel?: LogLevel;
  readonly traceId?: string;
  readonly sinceTimestamp?: number;
  readonly untilTimestamp?: number;
  readonly searchSubstring?: string;
  readonly tagKey?: string;
  readonly tagValue?: string;
  readonly environment?: string;
  readonly release?: string;
}

export interface LogListOptions {
  readonly sortDir?: 'asc' | 'desc';
  readonly limit?: number;
  readonly offset?: number;
}

export const LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
  fatal: 5,
});