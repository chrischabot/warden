/**
 * Canonical built-in PII patterns.
 *
 * Each regex is `g`-flagged for global replacement. Patterns err on
 * the side of high precision over recall — narrow well-known
 * surface (RFC-shaped email, E.164 phone, Luhn-validated PAN, the
 * AWS `AKIA…` prefix, JWT three-segment base64url shape, …).
 *
 * Spec §3.1 lists more (Azure secrets, JWT-like tokens) — coverage
 * grows iteratively. Per-project `customPatterns` cover the long tail.
 */

import { isLuhnValid } from './luhn';
import type { ScrubPattern } from './types';

/** Stable map keyed by pattern name. */
export const BUILTIN_PATTERNS: Readonly<Record<string, ScrubPattern>> = Object.freeze({
  email: {
    name: 'email',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  phone_e164: {
    name: 'phone_e164',
    // E.164: leading +, then 1-9, then 1..14 digits.
    regex: /\+[1-9]\d{1,14}\b/g,
  },
  credit_card: {
    name: 'credit_card',
    // Generic 13-19 digit run, possibly separated by spaces/dashes.
    regex: /\b(?:\d[ -]?){12,18}\d\b/g,
    validator: (match) => isLuhnValid(match),
  },
  ssn_us: {
    name: 'ssn_us',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  iban: {
    name: 'iban',
    // IBAN: 2 letters country, 2 digit checksum, up to 30 alphanumerics.
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
  },
  jwt: {
    name: 'jwt',
    // Three base64url segments separated by dots; header starts `eyJ`.
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  bearer_token: {
    name: 'bearer_token',
    // `Bearer <token>` with a fairly long opaque token.
    regex: /\bBearer\s+[A-Za-z0-9._-]{20,}/g,
  },
  aws_access_key: {
    name: 'aws_access_key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  aws_secret_in_url: {
    name: 'aws_secret_in_url',
    // AWS secret often appears in query strings: ?...aws_secret_access_key=...
    regex: /aws_secret_access_key=[A-Za-z0-9/+=]+/gi,
  },
  gcp_service_account_email: {
    name: 'gcp_service_account_email',
    regex: /[a-zA-Z0-9-]+@[a-zA-Z0-9-]+\.iam\.gserviceaccount\.com/g,
  },
} as Readonly<Record<string, ScrubPattern>>);

/** All built-ins as an ordered array, evaluated in registration order. */
export const BUILTIN_PATTERN_ORDER: readonly ScrubPattern[] = Object.freeze([
  BUILTIN_PATTERNS.aws_access_key as ScrubPattern,
  BUILTIN_PATTERNS.aws_secret_in_url as ScrubPattern,
  BUILTIN_PATTERNS.jwt as ScrubPattern,
  BUILTIN_PATTERNS.bearer_token as ScrubPattern,
  BUILTIN_PATTERNS.credit_card as ScrubPattern,
  BUILTIN_PATTERNS.iban as ScrubPattern,
  BUILTIN_PATTERNS.ssn_us as ScrubPattern,
  BUILTIN_PATTERNS.email as ScrubPattern,
  BUILTIN_PATTERNS.gcp_service_account_email as ScrubPattern,
  BUILTIN_PATTERNS.phone_e164 as ScrubPattern,
]);
