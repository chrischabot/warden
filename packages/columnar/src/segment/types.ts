/**
 * Segment file format types and stable wire constants.
 *
 * Wire layout (read-from-end):
 *
 *   [Magic 8 bytes "SRSEG\\0\\1\\0\\0"]
 *   [Page bodies, concatenated, with 13-byte page headers]
 *   [Footer body]
 *   [u32 footer_byte_length LE]
 *
 * Page header (13 bytes):
 *   u32 page_total_length      (header + body)
 *   u8  encoding_tag           (matches EncodingTag in types.ts)
 *   u32 row_count
 *   u32 encoded_body_length
 *
 * Footer body:
 *   u32 column_count
 *   for each column:
 *     u32 column_id
 *     u32 name_byte_length
 *     bytes name_utf8
 *     u8  column_type
 *     u32 page_count
 *     for each page:
 *       u64 file_offset (LE)
 *       u32 byte_length
 *       u32 row_count
 *       u8  encoding_tag        (duplicated from page header for index-only scans)
 *       u8  has_zonemap         (0 | 1)
 *       u8  has_bloom           (0 | 1)
 *       [if has_zonemap=1] f64 min, f64 max
 *       [if has_bloom=1]   u32 bloom_byte_length, bytes bloom_body
 */

import type { EncodedColumn } from '../types';

/** Magic bytes at offset 0. `SRSEG` ASCII + version u8 + reserved padding. */
export const SEGMENT_MAGIC: Readonly<Uint8Array> = new Uint8Array([
  0x53, 0x52, 0x53, 0x45, 0x47, 0x01, 0x00, 0x00,
]);

export const PAGE_HEADER_LEN = 13;
export const SEGMENT_FOOTER_LENGTH_LEN = 4;

/** Stable column-type IDs. Never renumber. */
export const ColumnTypeId = Object.freeze({
  Int32: 1,
  Int64: 2,
  Uint32: 3,
  Float64: 4,
  String: 5,
  Binary: 6,
});

export type ColumnTypeIdValue = (typeof ColumnTypeId)[keyof typeof ColumnTypeId];

/** Numeric per-page zonemap. Strings/binary columns omit this. */
export interface Zonemap {
  readonly min: number;
  readonly max: number;
}

/** Spec for a single page emitted into the segment. */
export interface PageSpec {
  readonly encoded: EncodedColumn;
  readonly rowCount: number;
  readonly zonemap?: Zonemap | undefined;
  /** Pre-serialized BloomFilter bytes. Use BloomFilter.serialize() to produce. */
  readonly bloom?: Uint8Array | undefined;
}

/** Spec for a single column comprising one or more pages. */
export interface ColumnSpec {
  readonly id: number;
  readonly name: string;
  readonly type: ColumnTypeIdValue;
  readonly pages: readonly PageSpec[];
}

/** Spec passed to encodeSegment. */
export interface SegmentSpec {
  readonly columns: readonly ColumnSpec[];
}

// ---- Reader-facing metadata ----

export interface PageMetadata {
  readonly fileOffset: number;
  readonly byteLength: number;
  readonly rowCount: number;
  readonly encodingTag: number;
  readonly zonemap?: Zonemap | undefined;
  readonly bloom?: Uint8Array | undefined;
}

export interface ColumnMetadata {
  readonly id: number;
  readonly name: string;
  readonly type: ColumnTypeIdValue;
  readonly pages: readonly PageMetadata[];
}

export interface SegmentMetadata {
  readonly columns: readonly ColumnMetadata[];
}
