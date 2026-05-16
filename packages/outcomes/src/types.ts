/**
 * Outcome accounting types.
 *
 * Mirrors the outcome categories in Sentry's existing outcome
 * pipeline so the public "where did my events go?" answer is
 * compatible. Stable identifiers — never renumber.
 */

export const OUTCOME_REASONS = Object.freeze([
  'accepted',
  'rate_limited',
  'invalid',
  'filtered',
  'over_quota',
  'abuse',
  'client_discard',
  'network_error',
] as const);

export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

/** Input shape callers pass to a recorder. timestamp/quantity have defaults. */
export interface RecordedOutcome {
  readonly projectId: string;
  readonly dataCategory: string;
  readonly reason: OutcomeReason;
  readonly quantity?: number;
  readonly timestamp?: number;
}

/** Fully-resolved outcome with defaults applied. */
export interface Outcome {
  readonly timestamp: number;
  readonly projectId: string;
  readonly dataCategory: string;
  readonly reason: OutcomeReason;
  readonly quantity: number;
}

/** Common recorder surface; implementations may aggregate or buffer. */
export interface OutcomeRecorder {
  record(outcome: RecordedOutcome): void;
}
