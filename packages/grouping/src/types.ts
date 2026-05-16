/**
 * Minimal Event/Exception/Stacktrace types for fingerprinting.
 *
 * Mirrors the relevant subset of Sentry's payload schema. The
 * fingerprinting engine consults these fields only; the rest of
 * the event is opaque here.
 */

export interface Frame {
  /** Function or method name. */
  readonly function?: string;
  /** Module or namespace path (e.g. `app.api.users`). */
  readonly module?: string;
  /** Absolute file path (e.g. `/srv/app/users.py`). */
  readonly abs_path?: string;
  /** Source filename component (e.g. `users.py`). */
  readonly filename?: string;
  /** Source line number. */
  readonly lineno?: number;
  /** Explicit in-app override; takes priority over classifier rules. */
  readonly in_app?: boolean;
  /** Catch-all for additional fields we pass through but do not consult. */
  readonly [key: string]: unknown;
}

export interface Stacktrace {
  readonly frames?: readonly Frame[];
}

export interface ExceptionValue {
  readonly type?: string;
  readonly value?: string;
  readonly module?: string;
  readonly stacktrace?: Stacktrace;
}

export interface ExceptionInterface {
  readonly values?: readonly ExceptionValue[];
}

export interface Event {
  /** Explicit fingerprint set by the SDK or a server-side rule. */
  readonly fingerprint?: readonly string[];
  readonly platform?: string;
  readonly exception?: ExceptionInterface;
  readonly message?: string;
  readonly stacktrace?: Stacktrace;
  /** Other fields are passed through verbatim. */
  readonly [key: string]: unknown;
}

export type GroupingStrategy = 'fingerprint' | 'stacktrace' | 'exception' | 'message' | 'default';

export interface GroupingResult {
  /** 16-char lowercase hex of a 64-bit hash. */
  readonly groupHash: string;
  /** Fingerprint components that were hashed. */
  readonly fingerprint: readonly string[];
  /** Which level of the hierarchy produced the result. */
  readonly strategy: GroupingStrategy;
}

export interface GroupingOptions {
  /** Number of in-app frames considered, counting from the top. Default 5. */
  readonly topFrames?: number;
  /** Override the platform string for classifier rules. */
  readonly platform?: string;
}
