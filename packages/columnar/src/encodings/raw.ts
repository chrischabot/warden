/**
 * Raw fixed-width little-endian encodings.
 *
 * Wire format: each value packed contiguously in LE order, no padding.
 *
 * Portable: encoders/decoders use DataView with explicit `littleEndian`
 * so a segment written on x86 (LE) reads identically on a BE host.
 */

import type { EncodedColumn } from '../types';
import { EncodingTag, WIRE_ENDIAN_LITTLE } from '../types';

const LE = WIRE_ENDIAN_LITTLE;

// ---- Int32 ----

export function encodeRawInt32(values: ArrayLike<number>): EncodedColumn {
  const out = new Uint8Array(values.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    dv.setInt32(i * 4, values[i] as number, LE);
  }
  return Object.freeze({ tag: EncodingTag.Raw, count: values.length, bytes: out });
}

export function decodeRawInt32(bytes: Uint8Array, count: number): Int32Array {
  const need = count * 4;
  if (bytes.byteLength < need) {
    throw new RangeError(
      `decodeRawInt32: need ${need} bytes for ${count} values, got ${bytes.byteLength}`,
    );
  }
  const out = new Int32Array(count);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    out[i] = dv.getInt32(i * 4, LE);
  }
  return out;
}

// ---- Uint32 ----

export function encodeRawUint32(values: ArrayLike<number>): EncodedColumn {
  const out = new Uint8Array(values.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    dv.setUint32(i * 4, values[i] as number, LE);
  }
  return Object.freeze({ tag: EncodingTag.Raw, count: values.length, bytes: out });
}

export function decodeRawUint32(bytes: Uint8Array, count: number): Uint32Array {
  const need = count * 4;
  if (bytes.byteLength < need) {
    throw new RangeError(
      `decodeRawUint32: need ${need} bytes for ${count} values, got ${bytes.byteLength}`,
    );
  }
  const out = new Uint32Array(count);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    out[i] = dv.getUint32(i * 4, LE);
  }
  return out;
}

// ---- Int64 (BigInt) ----

export function encodeRawInt64(values: ArrayLike<bigint>): EncodedColumn {
  const out = new Uint8Array(values.length * 8);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    dv.setBigInt64(i * 8, values[i] as bigint, LE);
  }
  return Object.freeze({ tag: EncodingTag.Raw, count: values.length, bytes: out });
}

export function decodeRawInt64(bytes: Uint8Array, count: number): BigInt64Array {
  const need = count * 8;
  if (bytes.byteLength < need) {
    throw new RangeError(
      `decodeRawInt64: need ${need} bytes for ${count} values, got ${bytes.byteLength}`,
    );
  }
  const out = new BigInt64Array(count);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    out[i] = dv.getBigInt64(i * 8, LE);
  }
  return out;
}

// ---- Float64 ----

export function encodeRawFloat64(values: ArrayLike<number>): EncodedColumn {
  const out = new Uint8Array(values.length * 8);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    dv.setFloat64(i * 8, values[i] as number, LE);
  }
  return Object.freeze({ tag: EncodingTag.Raw, count: values.length, bytes: out });
}

export function decodeRawFloat64(bytes: Uint8Array, count: number): Float64Array {
  const need = count * 8;
  if (bytes.byteLength < need) {
    throw new RangeError(
      `decodeRawFloat64: need ${need} bytes for ${count} values, got ${bytes.byteLength}`,
    );
  }
  const out = new Float64Array(count);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    out[i] = dv.getFloat64(i * 8, LE);
  }
  return out;
}
