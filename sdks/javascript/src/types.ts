/**
 * Public types for the JavaScript SDK.
 *
 * The Event shape is a subset of Sentry's documented event schema —
 * just the fields the SDK populates today. Extensions (contexts,
 * breadcrumbs, releases, fingerprint overrides) plug in here over
 * iterations.
 */

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface Frame {
  function?: string;
  abs_path?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

export interface Stacktrace {
  frames: readonly Frame[];
}

export interface ExceptionValue {
  type: string;
  value: string;
  stacktrace?: Stacktrace;
}

export interface SdkInfo {
  name: string;
  version: string;
}

export interface User {
  id?: string;
  email?: string;
  ip_address?: string;
  username?: string;
}

export interface Event {
  event_id: string;
  timestamp: string;
  platform?: string;
  level?: SentryLevel;
  message?: string;
  exception?: { values: readonly ExceptionValue[] };
  sdk?: SdkInfo;
  user?: User;
  tags?: Readonly<Record<string, string>>;
  extra?: Readonly<Record<string, unknown>>;
  release?: string;
  environment?: string;
  /** Catch-all for forward-compatible extensions. */
  [key: string]: unknown;
}

export interface CaptureOptions {
  level?: SentryLevel;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: User;
}

export interface ClientOptions {
  readonly dsn: string;
  readonly release?: string;
  readonly environment?: string;
  readonly transport?: import('./transport').Transport;
  /** Maximum events buffered while a flush is in progress. Default 30. */
  readonly maxBufferedEvents?: number;
}

export const SDK_NAME = 'sentry-replica.javascript';
export const SDK_VERSION = '0.0.0';
