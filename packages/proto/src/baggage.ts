/**
 * W3C baggage header codec.
 *
 * Format: `key=value[;property=value], key=value, ...`
 *
 * The Sentry SDK propagation spec defines `sentry-<name>` keys
 * for trace_id, environment, release, public_key, sample_rate,
 * transaction, user_id, and sampled. We split those out into
 * `sentry` for typed access; everything else is preserved in
 * `thirdParty` insertion-ordered.
 */

export interface Baggage {
  readonly sentry: Readonly<Record<string, string>>;
  readonly thirdParty: ReadonlyArray<readonly [string, string]>;
}

export function parseBaggage(input: string): Baggage {
  const sentry: Record<string, string> = {};
  const thirdParty: Array<readonly [string, string]> = [];
  if (typeof input !== 'string' || input.length === 0) {
    return Object.freeze({
      sentry: Object.freeze(sentry),
      thirdParty: Object.freeze(thirdParty),
    });
  }
  for (const raw of input.split(',')) {
    const entry = raw.trim();
    if (entry.length === 0) continue;
    const semi = entry.indexOf(';');
    const kv = semi >= 0 ? entry.slice(0, semi).trim() : entry;
    const eq = kv.indexOf('=');
    if (eq < 0) continue;
    const key = kv.slice(0, eq).trim();
    const valueRaw = kv.slice(eq + 1).trim();
    if (key.length === 0) continue;
    let value: string;
    try {
      value = decodeURIComponent(valueRaw);
    } catch {
      value = valueRaw;
    }
    if (key.startsWith('sentry-')) {
      sentry[key.slice('sentry-'.length)] = value;
    } else {
      thirdParty.push(Object.freeze([key, value]));
    }
  }
  return Object.freeze({
    sentry: Object.freeze(sentry),
    thirdParty: Object.freeze(thirdParty),
  });
}

export function formatBaggage(b: Baggage): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(b.sentry)) {
    parts.push(`sentry-${k}=${encodeURIComponent(v)}`);
  }
  for (const [k, v] of b.thirdParty) {
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.join(',');
}
