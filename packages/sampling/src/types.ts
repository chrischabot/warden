/**
 * Dynamic sampling rule shape and decision types.
 *
 * A rule matches on a small set of event fields. Match values can
 * be a single primitive (equality), an array of primitives (any-of),
 * or omitted (wildcard). Rules are evaluated in order; the first
 * match wins.
 *
 * Spec §3.1: decisions are deterministic on `trace_id` so all
 * envelopes belonging to one trace are sampled together — either
 * the whole trace is kept or the whole trace is dropped.
 */

export type MatchValue = string | number | boolean;

export interface RuleConditions {
  /** Match an exact value, or any of several. Missing field = wildcard. */
  readonly platform?: MatchValue | readonly MatchValue[];
  readonly environment?: MatchValue | readonly MatchValue[];
  readonly release?: MatchValue | readonly MatchValue[];
  readonly transaction?: MatchValue | readonly MatchValue[];
  readonly user_id?: MatchValue | readonly MatchValue[];
  /** Type of envelope item: event, transaction, log, replay_event, ... */
  readonly item_type?: MatchValue | readonly MatchValue[];
}

export interface SamplingRule {
  readonly id: string;
  readonly conditions: RuleConditions;
  /** Probability in [0, 1] that a matching item is kept. */
  readonly sampleRate: number;
}

export interface EventLike {
  readonly trace_id?: string;
  readonly platform?: string;
  readonly environment?: string;
  readonly release?: string;
  readonly transaction?: string;
  readonly user_id?: string;
  readonly item_type?: string;
}

export type SampleDecisionKind = 'keep' | 'drop';

export interface SampleDecision {
  readonly decision: SampleDecisionKind;
  /** The rule that matched, or undefined if no rule matched. */
  readonly matchedRuleId?: string;
  /** Sample rate applied. */
  readonly rate: number;
}
