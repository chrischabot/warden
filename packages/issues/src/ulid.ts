/**
 * Compact ULID generator.
 *
 * ULID = 48-bit ms-precision timestamp (most-significant) + 80-bit
 * randomness. Encoded as 26 chars in Crockford's base32 alphabet.
 * Per ULID spec, monotone within a millisecond on the same
 * generator instance is desirable but not required at this scale.
 *
 * We use a single shared random buffer per call; for monotone
 * within-ms ordering, callers can use the higher-level
 * `monotonicUlid` wrapper.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ALPHABET_LEN = BigInt(ALPHABET.length);

function encodeBigInt(value: bigint, length: number): string {
  let v = value;
  let out = '';
  for (let i = 0; i < length; i++) {
    const digit = Number(v % ALPHABET_LEN);
    out = (ALPHABET[digit] as string) + out;
    v = v / ALPHABET_LEN;
  }
  return out;
}

export function ulid(time?: number): string {
  const t = time ?? Date.now();
  if (!Number.isFinite(t) || t < 0) {
    throw new RangeError(`ulid: time must be a non-negative finite number, got ${t}`);
  }
  const timeBytes = encodeBigInt(BigInt(Math.floor(t)), 10);
  const rand = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(rand);
  } else {
    for (let i = 0; i < rand.length; i++) rand[i] = Math.floor(Math.random() * 256);
  }
  let randBig = 0n;
  for (const b of rand) randBig = (randBig << 8n) | BigInt(b);
  const randStr = encodeBigInt(randBig, 16);
  return timeBytes + randStr;
}

/** Stateful monotone ULID generator for tight within-ms loops. */
export class MonotonicUlid {
  private lastTime = -1;
  private lastRand = 0n;
  next(time?: number): string {
    const t = time ?? Date.now();
    if (t === this.lastTime) {
      this.lastRand += 1n;
      const timeBytes = encodeBigInt(BigInt(t), 10);
      return timeBytes + encodeBigInt(this.lastRand, 16);
    }
    const id = ulid(t);
    this.lastTime = t;
    // Reparse the randomness portion so future ticks of the same
    // millisecond increment from the freshly chosen value.
    const randStr = id.slice(10);
    this.lastRand = decode(randStr);
    return id;
  }
}

function decode(s: string): bigint {
  let v = 0n;
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new RangeError(`ulid.decode: invalid character "${ch}"`);
    v = v * ALPHABET_LEN + BigInt(idx);
  }
  return v;
}
