/**
 * Base64-VLQ decoding for source-map v3 mappings.
 *
 * Each VLQ encodes a signed integer as a sequence of base64 digits.
 * Bit layout in each digit:
 *
 *   bit 5 (msb of 6) : continuation flag — set means another digit follows
 *   bits 0..4        : 5 bits of magnitude, LSB-first across digits
 *
 * The sign is at bit 0 of the assembled magnitude (the very lowest
 * bit produced by the first digit). The remaining bits form the
 * absolute value.
 *
 * Arithmetic note: JS bitshifts are 32-bit signed, so values that
 * span beyond ~2^30 magnitude overflow when shifted with `<<`/`>>>`.
 * We accumulate magnitude with `*` and `Math.floor(/ 32)` so all of
 * INT32 (and well past it, up to 2^53) decodes safely.
 */

const BASE64_TABLE = new Uint8Array(128).fill(0xff);
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
{
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    BASE64_TABLE[BASE64_CHARS.charCodeAt(i)] = i;
  }
}

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE = 1 << VLQ_BASE_SHIFT; // 32
const VLQ_BASE_MASK = VLQ_BASE - 1; // 0x1f
const VLQ_CONTINUATION_BIT = VLQ_BASE; // 0x20
const SAFE_MAGNITUDE = Number.MAX_SAFE_INTEGER; // 2^53 - 1

export class VlqDecodeError extends RangeError {
  public readonly atPosition: number;
  constructor(message: string, atPosition: number) {
    super(message);
    this.name = 'VlqDecodeError';
    this.atPosition = atPosition;
  }
}

export interface VlqResult {
  readonly value: number;
  readonly nextPos: number;
}

/**
 * Decode one signed VLQ starting at `s[startPos]`. Returns the
 * decoded value and the position immediately after the last
 * consumed character.
 */
export function decodeVlq(s: string, startPos: number): VlqResult {
  let result = 0;
  let shiftMul = 1; // 2^(VLQ_BASE_SHIFT * digits-seen)
  let pos = startPos;
  while (true) {
    if (pos >= s.length) {
      throw new VlqDecodeError(`VLQ: unexpected end at pos ${pos}`, pos);
    }
    const code = s.charCodeAt(pos);
    if (code >= BASE64_TABLE.length) {
      throw new VlqDecodeError(`VLQ: invalid base64 char code ${code} at pos ${pos}`, pos);
    }
    const digit = BASE64_TABLE[code] as number;
    if (digit === 0xff) {
      throw new VlqDecodeError(
        `VLQ: invalid base64 char ${JSON.stringify(s[pos])} at pos ${pos}`,
        pos,
      );
    }
    pos++;
    result += (digit & VLQ_BASE_MASK) * shiftMul;
    if (result > SAFE_MAGNITUDE) {
      throw new VlqDecodeError(`VLQ: value exceeds safe integer range at pos ${pos}`, pos);
    }
    if ((digit & VLQ_CONTINUATION_BIT) === 0) break;
    shiftMul *= VLQ_BASE;
    if (shiftMul > SAFE_MAGNITUDE) {
      throw new VlqDecodeError(`VLQ: too many continuation bytes at pos ${pos}`, pos);
    }
  }
  const negative = result % 2 === 1;
  const magnitude = (result - (negative ? 1 : 0)) / 2;
  return { value: negative ? -magnitude : magnitude, nextPos: pos };
}

/** Encode a signed integer as base64-VLQ. */
export function encodeVlq(value: number): string {
  if (!Number.isInteger(value)) {
    throw new RangeError(`encodeVlq: value must be an integer, got ${value}`);
  }
  let v = value < 0 ? -value * 2 + 1 : value * 2;
  if (v > SAFE_MAGNITUDE) {
    throw new RangeError(`encodeVlq: |value| exceeds the safe integer range`);
  }
  let out = '';
  do {
    let digit = v % VLQ_BASE;
    v = Math.floor(v / VLQ_BASE);
    if (v > 0) digit |= VLQ_CONTINUATION_BIT;
    out += BASE64_CHARS[digit];
  } while (v > 0);
  return out;
}
