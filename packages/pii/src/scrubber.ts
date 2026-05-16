/**
 * PII scrubber.
 *
 * Replaces every regex match in supplied strings/objects with
 * `[Filtered]` (configurable). Built-in and custom patterns are
 * compiled exactly once at `new Scrubber(...)` time, joined into a
 * single union regex with a named capture per pattern so the
 * replace callback can route the match to its (optional) validator
 * — used for Luhn-validated credit-card matches. This avoids
 * the per-call `new RegExp(...)` and the N-passes-over-the-string
 * pattern that the earlier implementation used.
 *
 * Per-pattern regex flags are preserved: every flag that appears
 * on any pattern is included in the union, with the exception of
 * `g` which the implementation always sets. Conflicts that change
 * semantics across patterns (e.g. mixing `s` and not-`s`) would
 * still go through the union with `s` set, which is permissive —
 * if you need strict per-pattern semantics, use `customPatterns`
 * sparingly or run individual scrubbers for incompatible regexes.
 *
 * Three entry points:
 *   - `scrubString(s)` — string in, string out.
 *   - `scrub(value)` — JSON-shaped value walker; descends arrays
 *     and plain objects, scrubs every string. Pure (input not mutated).
 *   - `scrubRawJson(text)` — operates directly on a JSON-serialized
 *     string. Includes a `mayContainPii(text)` fast prefilter so the
 *     vast majority of payloads (which contain no PII) skip work
 *     entirely. The replacement substring `[Filtered]` contains no
 *     JSON metacharacters, so substituting it in-place on the
 *     serialized JSON is safe and avoids a parse/walk/stringify
 *     roundtrip.
 *
 * Spec §3.1 mandates that scrubbing runs over JSON payload Items
 * but **never over attachment bodies**. Callers feed JSON-decoded
 * item payloads (or the original JSON string) only.
 */

import { BUILTIN_PATTERN_ORDER, BUILTIN_PATTERNS } from './patterns';
import type { ScrubberConfig, ScrubPattern } from './types';

const DEFAULT_REPLACEMENT = '[Filtered]';

export class Scrubber {
  readonly patterns: readonly ScrubPattern[];
  readonly replacement: string;
  /** Combined union regex, `g` flag set, one named capture per pattern. */
  private readonly combined: RegExp;
  /**
   * Same union without the `g` flag, used by `mayContainPii` as a
   * short-circuit pre-scan: `combinedTest.test(s)` returns on the
   * first match anywhere in the string and never builds capture state.
   */
  private readonly combinedTest: RegExp;
  private readonly groupValidators: ReadonlyMap<string, (match: string) => boolean>;
  private readonly noPatterns: boolean;

  constructor(config: ScrubberConfig = {}) {
    this.replacement = config.replacement ?? DEFAULT_REPLACEMENT;
    this.patterns = resolvePatterns(config);
    this.noPatterns = this.patterns.length === 0;

    if (this.noPatterns) {
      this.combined = /(?!)/g; // never matches
      this.combinedTest = /(?!)/;
      this.groupValidators = new Map();
      return;
    }

    // Consolidate flags across all patterns. `g` is always added
    // (the union uses replace which requires global). Flags that
    // affect matching semantics — `i`, `m`, `s`, `u` — are unioned
    // so that any pattern that needed them gets them.
    const flagSet = new Set<string>(['g']);
    for (const p of this.patterns) {
      for (const f of p.regex.flags) {
        if (f === 'g' || f === 'y') continue; // y (sticky) breaks union
        flagSet.add(f);
      }
    }
    const combinedFlags = [...flagSet].sort().join('');
    const testFlags = combinedFlags.replace('g', '');

    const parts: string[] = [];
    const validators = new Map<string, (m: string) => boolean>();
    let i = 0;
    for (const p of this.patterns) {
      const group = `p${i++}`;
      parts.push(`(?<${group}>${p.regex.source})`);
      if (p.validator) validators.set(group, p.validator);
    }
    const source = parts.join('|');
    this.combined = new RegExp(source, combinedFlags);
    this.combinedTest = new RegExp(source, testFlags);
    this.groupValidators = validators;
  }

  /** Scrub a JSON-shaped value. The input is not mutated. */
  scrub<T = unknown>(value: T): T {
    return walk(value, this) as T;
  }

  /** Scrub a single string. */
  scrubString(s: string): string {
    if (this.noPatterns) return s;
    if (!this.combinedTest.test(s)) return s;
    return this.scrubStringRaw(s);
  }

  /**
   * True if any pattern can match somewhere in the string. Cheap
   * — the engine returns on first byte that can't start any
   * alternative. Useful as a pre-filter on whole JSON payloads.
   */
  mayContainPii(s: string): boolean {
    if (this.noPatterns) return false;
    return this.combinedTest.test(s);
  }

  /**
   * Scrub a JSON-encoded string in-place (single union scan). The
   * replacement string contains no JSON-significant characters so
   * this preserves valid JSON structure without parse/stringify.
   */
  scrubRawJson(json: string): string {
    if (this.noPatterns) return json;
    if (!this.combinedTest.test(json)) return json;
    return this.scrubStringRaw(json);
  }

  /** Internal: assumes `mayContainPii` has already returned true. */
  private scrubStringRaw(s: string): string {
    return s.replace(this.combined, (match, ..._args) => {
      const last = _args[_args.length - 1];
      const groups = (typeof last === 'object' && last !== null ? last : undefined) as
        | Record<string, string | undefined>
        | undefined;
      if (groups) {
        for (const [name, captured] of Object.entries(groups)) {
          if (captured === undefined) continue;
          const v = this.groupValidators.get(name);
          if (v && !v(match)) return match;
          return this.replacement;
        }
      }
      return this.replacement;
    });
  }
}

function resolvePatterns(config: ScrubberConfig): readonly ScrubPattern[] {
  const out: ScrubPattern[] = [];
  const seen = new Set<string>();

  const enableSet = config.enable ? new Set(config.enable) : null;
  const disableSet = config.disable ? new Set(config.disable) : null;

  for (const p of BUILTIN_PATTERN_ORDER) {
    if (enableSet && !enableSet.has(p.name)) continue;
    if (disableSet && disableSet.has(p.name)) continue;
    out.push(p);
    seen.add(p.name);
  }

  if (config.customPatterns) {
    for (const p of config.customPatterns) {
      if (seen.has(p.name)) {
        throw new Error(`Scrubber: custom pattern name collision "${p.name}"`);
      }
      if (!p.regex.global) {
        throw new Error(
          `Scrubber: custom pattern "${p.name}" regex must have the global (g) flag so all occurrences are redacted`,
        );
      }
      if (p.regex.sticky) {
        throw new Error(
          `Scrubber: custom pattern "${p.name}" regex uses the sticky (y) flag, which is incompatible with the combined union scan`,
        );
      }
      seen.add(p.name);
      out.push(p);
    }
  }

  return Object.freeze(out);
}

function walk(value: unknown, scrubber: Scrubber): unknown {
  if (typeof value === 'string') return scrubber.scrubString(value);
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      out[i] = walk(value[i], scrubber);
    }
    return out;
  }
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      out[k] = walk(src[k], scrubber);
    }
    return out;
  }
  return value;
}

/** Convenience for the unconfigured "scrub everything" case. */
export function defaultScrubber(): Scrubber {
  return new Scrubber();
}
export { BUILTIN_PATTERNS };