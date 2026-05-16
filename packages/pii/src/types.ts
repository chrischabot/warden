/**
 * Public types for the PII scrubber.
 *
 * A pattern is `{ name, regex, validator? }`. Matching is by
 * `regex.exec` / `String.replace` over a single string value;
 * the optional `validator` runs over the matched substring and
 * lets the pattern reject false positives (used for Luhn on
 * credit-card-shaped strings).
 *
 * Built-in pattern names form a stable identifier set so per-project
 * configs can enable/disable specific patterns by name.
 */

export interface ScrubPattern {
  readonly name: string;
  readonly regex: RegExp;
  /** When provided, must return true for the match to be redacted. */
  readonly validator?: (match: string) => boolean;
}

export interface ScrubberConfig {
  /**
   * Built-in patterns to enable, by name. If omitted, all built-ins
   * are enabled. Pass an empty array to disable all built-ins
   * (e.g. to use only `customPatterns`).
   */
  readonly enable?: readonly string[];
  /** Names of built-ins to disable, applied after `enable`. */
  readonly disable?: readonly string[];
  /** Project-specific extra patterns. Names must be unique. */
  readonly customPatterns?: readonly ScrubPattern[];
  /** Replacement string. Default `[Filtered]`. */
  readonly replacement?: string;
}

export const BUILTIN_PATTERN_NAMES = Object.freeze([
  'email',
  'phone_e164',
  'credit_card',
  'ssn_us',
  'iban',
  'jwt',
  'bearer_token',
  'aws_access_key',
  'aws_secret_in_url',
  'gcp_service_account_email',
] as const);

export type BuiltinPatternName = (typeof BUILTIN_PATTERN_NAMES)[number];
