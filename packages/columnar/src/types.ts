/**
 * Public types for the columnar event-store kernel.
 *
 * Wire-format identifiers are stable across versions and must
 * never be renumbered. Add new encodings with the next available
 * tag; deprecate but do not reuse old tags.
 */

/** Tag identifying the encoding used for a column chunk page. */
export const EncodingTag = Object.freeze({
  Raw: 0,
  Dictionary: 1,
  RunLength: 2,
  DeltaForInt: 3,
  // Reserved for next-turn encodings:
  // Gorilla: 4,
  // RawZstd: 5,
  // JsonLz4: 6,
});

export type EncodingTagValue = (typeof EncodingTag)[keyof typeof EncodingTag];

/** A page of values encoded with a single encoding. */
export interface EncodedColumn {
  readonly tag: EncodingTagValue;
  /** Number of logical values represented. */
  readonly count: number;
  /** Encoded byte body. Does NOT include any outer page header. */
  readonly bytes: Uint8Array;
}

/** Logical column type. The segment-layer writer chooses encoding(s) per type. */
export type ColumnType = 'int32' | 'int64' | 'uint32' | 'float64' | 'string' | 'binary';

/** Endianness of every multi-byte field on the wire. */
export const WIRE_ENDIAN_LITTLE = true;
