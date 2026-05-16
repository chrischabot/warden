/**
 * Run-length encoding for Int32 columns.
 *
 * Used for sort-key prefixes: `project_id`, hour-bucket, level,
 * any column with long runs of identical values.
 *
 * Wire format: sequence of (run_count: u32 LE, value: i32 LE) pairs.
 * Total decoded values must match the page's declared `count`; the
 * decoder caps output at `count` to avoid runaway runs from bad input.
 */

import type { EncodedColumn } from '../types';
import { EncodingTag, WIRE_ENDIAN_LITTLE } from '../types';

const LE = WIRE_ENDIAN_LITTLE;
const PAIR_SIZE = 8; // 4 bytes count + 4 bytes value

export function encodeRleInt32(values: ArrayLike<number>): EncodedColumn {
  const n = values.length;
  if (n === 0) {
    return Object.freeze({ tag: EncodingTag.RunLength, count: 0, bytes: new Uint8Array(0) });
  }

  // First pass: count runs to size the output exactly.
  let runs = 1;
  for (let i = 1; i < n; i++) {
    if ((values[i] as number) !== (values[i - 1] as number)) runs++;
  }

  const out = new Uint8Array(runs * PAIR_SIZE);
  const dv = new DataView(out.buffer);
  let curVal = values[0] as number;
  let curCount = 1;
  let off = 0;
  for (let i = 1; i < n; i++) {
    const v = values[i] as number;
    if (v === curVal) {
      curCount++;
    } else {
      dv.setUint32(off, curCount, LE);
      dv.setInt32(off + 4, curVal, LE);
      off += PAIR_SIZE;
      curVal = v;
      curCount = 1;
    }
  }
  dv.setUint32(off, curCount, LE);
  dv.setInt32(off + 4, curVal, LE);

  return Object.freeze({ tag: EncodingTag.RunLength, count: n, bytes: out });
}

export function decodeRleInt32(bytes: Uint8Array, count: number): Int32Array {
  const out = new Int32Array(count);
  if (count === 0) return out;
  if (bytes.byteLength === 0) {
    throw new RangeError(`decodeRleInt32: expected ${count} values, got empty buffer`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  let written = 0;
  while (written < count) {
    if (off + PAIR_SIZE > bytes.byteLength) {
      throw new RangeError(
        `decodeRleInt32: truncated pair at offset ${off} (wrote ${written}/${count})`,
      );
    }
    const runCount = dv.getUint32(off, LE);
    const value = dv.getInt32(off + 4, LE);
    off += PAIR_SIZE;
    const writeCount = Math.min(runCount, count - written);
    for (let i = 0; i < writeCount; i++) {
      out[written + i] = value;
    }
    written += writeCount;
  }
  return out;
}
