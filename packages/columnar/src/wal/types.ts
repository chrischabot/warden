/**
 * Write-Ahead Log record types and config.
 *
 * On-disk record layout (per record):
 *   u32 record_length    (size of the payload region in bytes, i.e. type byte + payload)
 *   u32 crc32            (CRC32 of [type_byte | payload])
 *   u8  type             (RECORD_TYPE_WRITE | RECORD_TYPE_CHECKPOINT)
 *   bytes payload        (record_length - 1 bytes)
 *
 * Header is 9 bytes per record; the body is opaque to the WAL —
 * higher-level code (MemTable) serializes/deserializes per-record
 * semantics.
 *
 * Stable record types — never renumber.
 */

export const RECORD_TYPE_WRITE = 1 as const;
export const RECORD_TYPE_CHECKPOINT = 2 as const;

export type RecordType = typeof RECORD_TYPE_WRITE | typeof RECORD_TYPE_CHECKPOINT;

export const RECORD_HEADER_LEN = 9;

export interface WalRecord {
  readonly type: RecordType;
  readonly payload: Uint8Array;
  /** Offset of the record's first byte in the WAL file. */
  readonly fileOffset: number;
}

export interface WalConfig {
  /** Path to the WAL file. Parent directory must exist. */
  readonly path: string;
  /** Max ms to buffer writes before fsync. Default 5. */
  readonly fsyncIntervalMs?: number;
  /** Max accumulated bytes before forcing fsync. Default 256 KiB. */
  readonly fsyncBytesThreshold?: number;
}

export interface ReplayOptions {
  /**
   * Treat a truncated header or payload at the file tail as the
   * normal endpoint (a partial last record from a mid-write crash).
   * CRC mismatches elsewhere still throw.
   */
  readonly tolerateTrailingTruncation?: boolean;
}