/**
 * Sampler.
 *
 * Given a list of rules and an event-like input, produce a
 * `{ decision, matchedRuleId?, rate }`. The matching algorithm:
 *
 *   - Walk rules in order; for each rule check that every declared
 *     condition's value matches the event field (equality, or any-of
 *     when the rule's value is an array; missing/empty field on the
 *     event always fails to match unless the rule also omits that
 *     field).
 *   - The first matching rule provides the `sampleRate`; if no rule
 *     matches, the default rate applies.
 *
 * Decision is deterministic on `trace_id` (spec §3.1):
 *   normalized = hash64(trace_id) / 2^64 ∈ [0, 1)
 *   decision = normalized < rate ? keep : drop
 *
 * Without a `trace_id`, the sampler still wants a stable decision
 * for the same event, so it falls back to hashing the concatenated
 * non-empty fields. The decision is fully deterministic — there is
 * no per-instance random seed, and the same event input always
 * produces the same decision under the same rule set.
 */

import type { EventLike, MatchValue, RuleConditions, SampleDecision, SamplingRule } from './types';

const HASH_DIVISOR = 2 ** 64;

export interface SamplerOptions {
  /** Sample rate when no rule matches. Default 1.0 (keep everything). */
  readonly defaultSampleRate?: number;
}

export class Sampler {
  readonly rules: readonly SamplingRule[];
  readonly defaultSampleRate: number;

  constructor(rules: readonly SamplingRule[], options: SamplerOptions = {}) {
    for (const r of rules) {
      if (!Number.isFinite(r.sampleRate) || r.sampleRate < 0 || r.sampleRate > 1) {
        throw new RangeError(
          `Sampler: rule "${r.id}" sampleRate must be in [0, 1], got ${r.sampleRate}`,
        );
      }
    }
    const dflt = options.defaultSampleRate ?? 1.0;
    if (!Number.isFinite(dflt) || dflt < 0 || dflt > 1) {
      throw new RangeError(`Sampler: defaultSampleRate must be in [0, 1], got ${dflt}`);
    }
    this.rules = rules;
    this.defaultSampleRate = dflt;
  }

  /** Decide whether to keep this event. */
  decide(event: EventLike): SampleDecision {
    const match = this.firstMatch(event);
    const rate = match ? match.sampleRate : this.defaultSampleRate;
    const matchedRuleId = match ? match.id : undefined;
    if (rate <= 0) {
      return finalize('drop', rate, matchedRuleId);
    }
    if (rate >= 1) {
      return finalize('keep', rate, matchedRuleId);
    }
    const u = uniformFor(event);
    return finalize(u < rate ? 'keep' : 'drop', rate, matchedRuleId);
  }

  private firstMatch(event: EventLike): SamplingRule | undefined {
    for (const r of this.rules) {
      if (matchesAll(r.conditions, event)) return r;
    }
    return undefined;
  }
}

function finalize(
  decision: 'keep' | 'drop',
  rate: number,
  matchedRuleId: string | undefined,
): SampleDecision {
  return Object.freeze(
    matchedRuleId !== undefined ? { decision, rate, matchedRuleId } : { decision, rate },
  );
}

function matchesAll(conditions: RuleConditions, event: EventLike): boolean {
  return (
    matchesOne(conditions.platform, event.platform) &&
    matchesOne(conditions.environment, event.environment) &&
    matchesOne(conditions.release, event.release) &&
    matchesOne(conditions.transaction, event.transaction) &&
    matchesOne(conditions.user_id, event.user_id) &&
    matchesOne(conditions.item_type, event.item_type)
  );
}

function matchesOne(
  ruleValue: MatchValue | readonly MatchValue[] | undefined,
  eventValue: string | undefined,
): boolean {
  if (ruleValue === undefined) return true; // wildcard
  if (eventValue === undefined) return false; // rule requires a value
  if (Array.isArray(ruleValue)) {
    for (const v of ruleValue) {
      if (String(v) === eventValue) return true;
    }
    return false;
  }
  return String(ruleValue) === eventValue;
}

/**
 * Uniform [0, 1) value for the event. Deterministic on `trace_id`
 * when present; otherwise on the concatenated field signature.
 */
function uniformFor(event: EventLike): number {
  let key: string;
  if (event.trace_id && event.trace_id.length > 0) {
    key = event.trace_id;
  } else {
    key = [
      event.platform ?? '',
      event.environment ?? '',
      event.release ?? '',
      event.transaction ?? '',
      event.user_id ?? '',
      event.item_type ?? '',
    ].join('\u0000');
  }
  const raw = (Bun.hash as (data: string) => bigint)(key);
  const unsigned = BigInt.asUintN(64, raw);
  return Number(unsigned) / HASH_DIVISOR;
}
