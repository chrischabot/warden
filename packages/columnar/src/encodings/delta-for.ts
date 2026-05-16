/**
 * Delta + Frame-of-Reference encoding for Int32 columns.
 *
 * Best for monotone-or-near-monotone integer columns: sequence
 * numbers, hour-bucketed timestamps clamped to int32, dense ids.
 * For sparse / random int32 columns, fall back to raw encoding.
 *
 * Wire format (17 bytes header + bit-packed body):
 *   i32  first_value
 *   f64  min_delta     (stored as f64 so it survives the full
 *                      int32-delta range without int32 wrapping —
 *                      the magnitude of min_delta can reach
 *                      INT32_MAX - INT32_MIN = 2^32 - 1, which
 *                      does not fit in i32)
 *   u8   bits_per_packed_delta
 *   u32  count          (total values including the first)
 *   bytes packed (bit-packed (delta_i - min_delta) for i=1..count-1)
 *
 * `bits_per_packed_delta` is capped at 31. Columns with a 32-bit
 * delta range should use raw encoding instead — delta-FOR wouldn't
 * compress them anyway. The 31-bit cap on the per-element offset
 * combined with f64 min_delta means decoded values are always
 * exactly reproducible in JS Number precision and then stored
 * verbatim into the output Int32Array.
 *
 * Input preconditions: every element of `values` must be an integer
 * in the signed int32 range, i.e. -2^31 ≤ v ≤ 2^31 - 1. This is
 * not validated at runtime; passing a non-integer or out-of-range
 * value produces undefined output. Use raw float64 encoding for
 * non-integer columns.
 */

import { BitReader, BitWriter } from '../bit-buffer';
import type { EncodedColumn } from '../types';
import { EncodingTag, WIRE_ENDIAN_LITTLE } from '../types';

const LE = WIRE_ENDIAN_LITTLE;

// Header offsets.
const OFF_FIRST = 0;
const OFF_MIN_DELTA = 4;
const OFF_BITS = 12;
const OFF_COUNT = 13;
const HEADER_LEN = 17;

export class DeltaForOverflowError extends RangeError {
  constructor(range: number) {
    super(
      `delta-FOR: delta range ${range} exceeds 31-bit capacity. Use raw encoding for this column.`,
    );
    this.name = 'DeltaForOverflowError';
  }
}

export function encodeDeltaForInt32(values: ArrayLike<number>): EncodedColumn {
  const n = values.length;

  if (n === 0) {
    const out = new Uint8Array(HEADER_LEN);
    new DataView(out.buffer).setUint32(OFF_COUNT, 0, LE);
    return Object.freeze({ tag: EncodingTag.DeltaForInt, count: 0, bytes: out });
  }
  const first = values[0] as number;
  if (n === 1) {
    const out = new Uint8Array(HEADER_LEN);
    const dv = new DataView(out.buffer);
    dv.setInt32(OFF_FIRST, first, LE);
    dv.setFloat64(OFF_MIN_DELTA, 0, LE);
    out[OFF_BITS] = 0;
    dv.setUint32(OFF_COUNT, 1, LE);
    return Object.freeze({ tag: EncodingTag.DeltaForInt, count: 1, bytes: out });
  }

  // Deltas live in Float64Array so values like INT32_MAX - INT32_MIN
  // (= 4_294_967_295) are preserved precisely; Int32Array would
  // silently truncate. JS Numbers are exact integers up to 2^53,
  // well past anything we can produce from int32 inputs.
  const deltas = new Float64Array(n - 1);
  let minDelta = (values[1] as number) - (values[0] as number);
  let maxDelta = minDelta;
  deltas[0] = minDelta;
  for (let i = 2; i < n; i++) {
    const d = (values[i] as number) - (values[i - 1] as number);
    deltas[i - 1] = d;
    if (d < minDelta) minDelta = d;
    if (d > maxDelta) maxDelta = d;
  }

  // Compute the packed-offset range in JS Number space (no `>>> 0`
  // truncation — that would silently mask the overflow case).
  const range = maxDelta - minDelta;
  const bits = range === 0 ? 0 : Math.ceil(Math.log2(range + 1));
  if (bits > 31) {
    throw new DeltaForOverflowError(range);
  }

  const bw = new BitWriter();
  for (let i = 0; i < deltas.length; i++) {
    // Offset is non-negative and ≤ 2^bits - 1 ≤ 2^31 - 1, so it fits
    // a signed int32 unchanged; `>>> 0` is safe-identity here.
    const offset = ((deltas[i] as number) - minDelta) >>> 0;
    bw.writeBits(offset, bits);
  }
  const packed = bw.finish();

  const out = new Uint8Array(HEADER_LEN + packed.byteLength);
  const dv = new DataView(out.buffer);
  dv.setInt32(OFF_FIRST, first, LE);
  dv.setFloat64(OFF_MIN_DELTA, minDelta, LE);
  out[OFF_BITS] = bits & 0xff;
  dv.setUint32(OFF_COUNT, n, LE);
  out.set(packed, HEADER_LEN);

  return Object.freeze({ tag: EncodingTag.DeltaForInt, count: n, bytes: out });
}

export function decodeDeltaForInt32(bytes: Uint8Array): Int32Array {
  if (bytes.byteLength < HEADER_LEN) {
    throw new RangeError(`decodeDeltaForInt32: header too short (${bytes.byteLength} bytes)`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = dv.getInt32(OFF_FIRST, LE);
  const minDelta = dv.getFloat64(OFF_MIN_DELTA, LE);
  const bits = bytes[OFF_BITS] as number;
  const count = dv.getUint32(OFF_COUNT, LE);

  const out = new Int32Array(count);
  if (count === 0) return out;
  out[0] = first;
  if (count === 1) return out;

  if (bits > 31) {
    throw new RangeError(`decodeDeltaForInt32: bits ${bits} exceeds 31-bit capacity`);
  }

  const packed = bytes.subarray(HEADER_LEN);
  if (bits === 0) {
    // All deltas equal to minDelta. Run sum in JS Number space and
    // truncate only at Int32Array store time.
    let prev = first;
    for (let i = 1; i < count; i++) {
      const next = prev + minDelta;
      out[i] = next;
      prev = next | 0;
    }
    return out;
  }
  const br = new BitReader(packed);
  let prev = first;
  for (let i = 1; i < count; i++) {
    const offset = br.readBits(bits);
    const delta = offset + minDelta;
    const next = prev + delta;
    out[i] = next;
    prev = next | 0;
  }
  return out;
}
