/**
 * Public types for the segmented log.
 *
 * On-disk record layout (per record), identical to the columnar
 * WAL format so the format-handling vocabulary is shared:
 *
 *   byte 0..3 : u32 record_length   (= 1 + payload.byteLength;
 *                                    includes the type byte)
 *   byte 4..7 : u32 crc32           (over type_byte | payload_bytes)
 *   byte 8    : u8  type
 *   byte 9..  : payload             (record_length - 1 bytes)
 *
 * A segment file is a concatenation of these records. The file name
 * is `segment-<base_offset_zero_padded_to_20>.log`, with `base_offset`
 * the bigint offset of the first record in that segment.
 *
 * Stable record types — never renumber.
 */

export const RECORD_TYPE_WRITE = 1 as const;
export const RECORD_TYPE_CHECKPOINT = 2 as const;

export type RecordType = typeof RECORD_TYPE_WRITE | typeof RECORD_TYPE_CHECKPOINT;

export const RECORD_HEADER_LEN = 9;

export interface SegmentedLogConfig {
  /** Directory containing segment files. Created if absent. */
  readonly dir: string;
  /** Roll the active segment when its byte size reaches this. Default 256 MiB. */
  readonly maxSegmentBytes?: number;
  /** Roll the active segment when its age reaches this. Default 1 hour. */
  readonly maxSegmentAgeMs?: number;
  /** Max ms to buffer writes before fsync. Default 5. */
  readonly fsyncIntervalMs?: number;
  /** Max accumulated bytes before forcing fsync. Default 256 KiB. */
  readonly fsyncBytesThreshold?: number;
}

export interface LogRecord {
  /** Monotonic offset within the entire log (across all segments). */
  readonly offset: bigint;
  readonly type: RecordType;
  readonly payload: Uint8Array;
  /** Base offset of the segment this record lives in. */
  readonly segmentBaseOffset: bigint;
  /** Byte position within the segment file. */
  readonly fileOffset: number;
}

export interface ReadOptions {
  /** Treat partial trailing record as the natural endpoint of the segment. Default true. */
  readonly tolerateTrailingTruncation?: boolean;
  /** Stop after yielding this many records. */
  readonly limit?: number;
}

export class LogCorruptError extends Error {
  public readonly offset: bigint;
  public readonly path: string;
  constructor(message: string, offset: bigint, path: string) {
    super(message);
    this.name = 'LogCorruptError';
    this.offset = offset;
    this.path = path;
  }
}
