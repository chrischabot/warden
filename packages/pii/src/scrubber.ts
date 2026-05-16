/**
 * PII scrubber.
 *
 * `new Scrubber(config).scrub(value)` returns a new JSON value
 * (same shape as `value`) with every regex match replaced by
 * `[Filtered]` (configurable). The walker descends into objects
 * and arrays; primitive non-strings pass through unchanged.
 *
 * Pattern application is sequential in the order they were enabled.
 * Each pattern is `g`-flagged so all occurrences in a single
 * string are redacted.
 *
 * Spec §3.1 mandates that scrubbing runs over JSON payload Items
 * but **never over attachment bodies**. Callers should only feed
 * JSON-decoded item payloads to `scrub()`, not the raw bytes of
 * binary attachments.
 */

import { BUILTIN_PATTERN_ORDER, BUILTIN_PATTERNS } from './patterns';
import type { ScrubberConfig, ScrubPattern } from './types';

const DEFAULT_REPLACEMENT = '[Filtered]';

export class Scrubber {
  readonly patterns: readonly ScrubPattern[];
  readonly replacement: string;

  constructor(config: ScrubberConfig = {}) {
    this.replacement = config.replacement ?? DEFAULT_REPLACEMENT;
    this.patterns = resolvePatterns(config);
  }

  /** Scrub a JSON-shaped value. The input is not mutated. */
  scrub<T = unknown>(value: T): T {
    return walk(value, this.patterns, this.replacement) as T;
  }

  /** Scrub a single string. */
  scrubString(s: string): string {
    return scrubStr(s, this.patterns, this.replacement);
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
      seen.add(p.name);
      out.push(p);
    }
  }

  return Object.freeze(out);
}

function walk(value: unknown, patterns: readonly ScrubPattern[], replacement: string): unknown {
  if (typeof value === 'string') return scrubStr(value, patterns, replacement);
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      out[i] = walk(value[i], patterns, replacement);
    }
    return out;
  }
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      out[k] = walk(src[k], patterns, replacement);
    }
    return out;
  }
  return value; // number, boolean, bigint, symbol, function — passthrough
}

function scrubStr(s: string, patterns: readonly ScrubPattern[], replacement: string): string {
  let out = s;
  for (const p of patterns) {
    // Clone the regex per call so `lastIndex` doesn't leak across runs;
    // `replace(regex, fn)` resets it, but a per-call regex is safer.
    const re = new RegExp(p.regex.source, p.regex.flags);
    if (p.validator) {
      out = out.replace(re, (match) => (p.validator!(match) ? replacement : match));
    } else {
      out = out.replace(re, replacement);
    }
  }
  return out;
}

/** Convenience for the unconfigured "scrub everything" case. */
export function defaultScrubber(): Scrubber {
  return new Scrubber();
}
export { BUILTIN_PATTERNS };
