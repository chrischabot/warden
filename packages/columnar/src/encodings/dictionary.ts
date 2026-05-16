/**
 * String dictionary + bit-packed ids.
 *
 * Used for low-to-medium-cardinality string columns: `project_id`,
 * `environment`, `release`, `platform`, `level`, `type`,
 * `sdk.name`, `os.name`, `browser.name`, etc.
 *
 * Wire format:
 *   u32  dictCount
 *   for each dict entry:
 *     u32  strLen
 *     bytes (UTF-8, strLen bytes)
 *   u8   bitsPerId   (always ≥ 1; for empty or single-entry
 *                     dictionaries we still use 1 bit per id so
 *                     the reader has a well-defined width)
 *   u32  packedLen   (length in bytes of the packed-id body)
 *   bytes packedIds  (bit-packed ids, MSB-first per byte)
 *
 * The dictionary is built in insertion order, which keeps the
 * encoding deterministic and reproducible.
 */

import { BitReader, BitWriter } from '../bit-buffer';
import type { EncodedColumn } from '../types';
import { EncodingTag, WIRE_ENDIAN_LITTLE } from '../types';

const LE = WIRE_ENDIAN_LITTLE;
const utf8Enc = new TextEncoder();
const utf8Dec = new TextDecoder('utf-8', { fatal: false });

export function encodeStringDictionary(values: readonly string[]): EncodedColumn {
  // Build dictionary in insertion order.
  const dict: string[] = [];
  const idMap = new Map<string, number>();
  for (const v of values) {
    if (!idMap.has(v)) {
      idMap.set(v, dict.length);
      dict.push(v);
    }
  }

  // Bits per id. Empty / single-value dictionaries use 1 bit so
  // the BitReader has something to read; a 0-bit id would require
  // out-of-band 'all zero' signalling.
  const bitsPerId = dict.length <= 1 ? 1 : Math.ceil(Math.log2(dict.length));

  // Pack ids.
  const bw = new BitWriter();
  for (const v of values) {
    bw.writeBits(idMap.get(v) as number, bitsPerId);
  }
  const packed = bw.finish();

  // Serialize dictionary entries.
  const dictBytes: Uint8Array[] = dict.map((s) => utf8Enc.encode(s));
  let totalDict = 0;
  for (const b of dictBytes) totalDict += 4 + b.byteLength;

  const headerLen = 4 + totalDict + 1 + 4;
  const out = new Uint8Array(headerLen + packed.byteLength);
  const dv = new DataView(out.buffer);
  let off = 0;
  dv.setUint32(off, dict.length, LE);
  off += 4;
  for (const b of dictBytes) {
    dv.setUint32(off, b.byteLength, LE);
    off += 4;
    out.set(b, off);
    off += b.byteLength;
  }
  out[off] = bitsPerId & 0xff;
  off += 1;
  dv.setUint32(off, packed.byteLength, LE);
  off += 4;
  out.set(packed, off);

  return Object.freeze({
    tag: EncodingTag.Dictionary,
    count: values.length,
    bytes: out,
  });
}

export function decodeStringDictionary(bytes: Uint8Array, count: number): string[] {
  if (bytes.byteLength < 4) {
    throw new RangeError(`decodeStringDictionary: header truncated (${bytes.byteLength} bytes)`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;

  const dictCount = dv.getUint32(off, LE);
  off += 4;

  const dict: string[] = new Array(dictCount);
  for (let i = 0; i < dictCount; i++) {
    if (off + 4 > bytes.byteLength) {
      throw new RangeError(`decodeStringDictionary: truncated dict entry length at ${off}`);
    }
    const strLen = dv.getUint32(off, LE);
    off += 4;
    if (off + strLen > bytes.byteLength) {
      throw new RangeError(`decodeStringDictionary: truncated dict entry body at ${off}`);
    }
    dict[i] = utf8Dec.decode(bytes.subarray(off, off + strLen));
    off += strLen;
  }

  if (off + 5 > bytes.byteLength) {
    throw new RangeError(`decodeStringDictionary: truncated id-pack header at ${off}`);
  }
  const bitsPerId = bytes[off] as number;
  off += 1;
  const packedLen = dv.getUint32(off, LE);
  off += 4;
  if (off + packedLen > bytes.byteLength) {
    throw new RangeError(
      `decodeStringDictionary: truncated packed-ids body (need ${packedLen} bytes from ${off})`,
    );
  }
  const packed = bytes.subarray(off, off + packedLen);

  const out: string[] = new Array(count);
  if (count === 0) return out;
  const br = new BitReader(packed);
  for (let i = 0; i < count; i++) {
    const id = br.readBits(bitsPerId);
    if (id >= dict.length) {
      throw new RangeError(
        `decodeStringDictionary: id ${id} out of range (dict size ${dict.length})`,
      );
    }
    out[i] = dict[id] as string;
  }
  return out;
}
