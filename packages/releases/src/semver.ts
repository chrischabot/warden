/**
 * SemVer 2.0.0 parser. Used to sort releases for "release adoption"
 * graphs and to compute "first release" / "last release" on an
 * issue.
 *
 * Accepts: `MAJOR.MINOR.PATCH[-PRE][+BUILD]`
 *
 * Rejects:
 *   - Missing minor/patch
 *   - Leading zeros on numeric identifiers
 *   - Empty pre-release identifier
 *   - Invalid characters in pre / build
 *
 * Pre-release ordering follows the spec: 1.0.0-alpha < 1.0.0.
 * Build metadata is ignored for ordering.
 */

import type { ParsedSemver } from './types';

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseSemver(input: string): ParsedSemver | undefined {
  const m = SEMVER_RE.exec(input);
  if (!m) return undefined;
  return Object.freeze({
    major: Number.parseInt(m[1] as string, 10),
    minor: Number.parseInt(m[2] as string, 10),
    patch: Number.parseInt(m[3] as string, 10),
    pre: m[4] ?? '',
    build: m[5] ?? '',
  });
}

/**
 * Compare two semver strings. Returns -1 / 0 / +1. Non-semver
 * strings compare lexicographically against each other and rank
 * lower than any semver string (mirrors Sentry behaviour).
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa && pb) return compareParsed(pa, pb);
  if (pa && !pb) return 1;
  if (!pa && pb) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareParsed(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Pre-release comparison.
  if (a.pre === '' && b.pre === '') return 0;
  // Per spec: empty pre-release ranks ABOVE any non-empty pre-release.
  if (a.pre === '') return 1;
  if (b.pre === '') return -1;
  const aIds = a.pre.split('.');
  const bIds = b.pre.split('.');
  const len = Math.min(aIds.length, bIds.length);
  for (let i = 0; i < len; i++) {
    const ai = aIds[i] as string;
    const bi = bIds[i] as string;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number.parseInt(ai, 10) - Number.parseInt(bi, 10);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNum && !bNum) {
      return -1; // numeric < alphanumeric
    } else if (!aNum && bNum) {
      return 1;
    } else {
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
  }
  return aIds.length - bIds.length;
}
