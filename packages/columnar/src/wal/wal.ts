/**
 * Write-Ahead Log.
 *
 * Append-only, single-writer-per-file, group-commit fsync.
 *
 * On-disk record layout — important for understanding the offset
 * arithmetic below:
 *
 *   byte 0..3 : u32 record_length   (= 1 + payload.byteLength;
 *                                    includes the type byte)
 *   byte 4..7 : u32 crc32           (over type_byte | payload_bytes)
 *   byte 8    : u8  type
 *   byte 9..  : payload             (record_length - 1 bytes)
 *
 * So one full record on disk consumes:
 *
 *     8 bytes (length + crc) + record_length
 *   = 8 + 1 + payload.byteLength
 *   = RECORD_HEADER_LEN (9) + payload.byteLength
 *   = RECORD_HEADER_LEN + payloadLen
 *
 * RECORD_HEADER_LEN is the type-inclusive header size; the type
 * byte is NOT counted again in the payload region. Replay advances
 * `pos += RECORD_HEADER_LEN + payloadLen`, which is the same as
 * `pos += 8 + recordLen` — both correct.
 *
 * Group-commit semantics:
 *   - Each `append(payload)` builds a record and enqueues a resolver.
 *   - If accumulated pending bytes exceed `fsyncBytesThreshold`, a
 *     flush is dispatched immediately (timer cancelled).
 *   - Otherwise a timer is armed for `fsyncIntervalMs`; when it
 *     fires, all pending records are written and fsynced in one
 *     batch, and every resolver in that batch resolves.
 *   - A single flush task runs at a time (`flushLoop`); appends
 *     that arrive during a flush are queued for the next iteration.
 *
 * Replay reads records sequentially, validates CRC32 per record,
 * and reports each via the callback. Trailing partial records can
 * be tolerated (typical after a mid-write crash).
 */

import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import {
  RECORD_HEADER_LEN,
  RECORD_TYPE_CHECKPOINT,
  RECORD_TYPE_WRITE,
  type RecordType,
  type ReplayOptions,
  type WalConfig,
  type WalRecord,
} from './types';

const DEFAULT_FSYNC_INTERVAL_MS = 5;
const DEFAULT_FSYNC_BYTES = 256 * 1024;

export class WalCorruptError extends Error {
  public readonly atOffset: number;
  constructor(message: string, atOffset: number) {
    super(message);
    this.name = 'WalCorruptError';
    this.atOffset = atOffset;
  }
}

interface PendingWrite {
  readonly bytes: Uint8Array;
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
}

export class Wal {
  private readonly fsyncIntervalMs: number;
  private readonly fsyncBytesThreshold: number;
  private fileHandle: FileHandle | undefined;
  private writePosition = 0;
  private pending: PendingWrite[] = [];
  private pendingBytes = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushTask: Promise<void> | undefined;
  private closed = false;

  constructor(public readonly config: WalConfig) {
    this.fsyncIntervalMs = config.fsyncIntervalMs ?? DEFAULT_FSYNC_INTERVAL_MS;
    this.fsyncBytesThreshold = config.fsyncBytesThreshold ?? DEFAULT_FSYNC_BYTES;
  }

  /** Open the WAL file, creating if absent. Idempotent. */
  async open(): Promise<void> {
    if (this.fileHandle) return;
    // 'a+' = read + append-only writes. The OS appends regardless of
    // the position arg on every write, so our writePosition is just
    // a bookkeeping cursor for replay reads.
    this.fileHandle = await fs.open(this.config.path, 'a+');
    const stat = await this.fileHandle.stat();
    this.writePosition = stat.size;
  }

  /** Append a WRITE record. Resolves when the record is durably on disk. */
  async append(payload: Uint8Array): Promise<void> {
    return this.appendRecord(RECORD_TYPE_WRITE, payload);
  }

  /** Append a CHECKPOINT record. Optional payload (e.g. last-flushed segment id). */
  async checkpoint(payload: Uint8Array = new Uint8Array(0)): Promise<void> {
    return this.appendRecord(RECORD_TYPE_CHECKPOINT, payload);
  }

  /** Force any pending writes to flush + fsync now. */
  async sync(): Promise<void> {
    this.cancelTimer();
    this.startFlushIfIdle();
    if (this.flushTask) await this.flushTask;
  }

  /** Flush + fsync any pending writes, then close the file. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sync();
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = undefined;
    }
  }

  /**
   * Replay every record in the WAL in file order. Validates CRC per
   * record. The callback is invoked synchronously for each record.
   *
   * Offset arithmetic (see file-level comment for the layout):
   *
   *   one record consumes RECORD_HEADER_LEN (9) bytes of header
   *   (length + crc + type) followed by payloadLen bytes of payload,
   *   where payloadLen = recordLen - 1 (recordLen is the type-byte-
   *   inclusive length stored in bytes 0..3). The total step is
   *   `RECORD_HEADER_LEN + payloadLen`, equivalently `8 + recordLen`.
   */
  async replay(
    callback: (record: WalRecord) => void,
    options: ReplayOptions = {},
  ): Promise<void> {
    if (!this.fileHandle) throw new Error('Wal.replay: not open');
    const stat = await this.fileHandle.stat();
    const totalSize = stat.size;
    let pos = 0;
    while (pos < totalSize) {
      // Read header (length + crc + type).
      if (pos + RECORD_HEADER_LEN > totalSize) {
        if (options.tolerateTrailingTruncation) return;
        throw new WalCorruptError(
          `truncated record header at offset ${pos} (have ${totalSize - pos} bytes, need ${RECORD_HEADER_LEN})`,
          pos,
        );
      }
      const headerBuf = Buffer.alloc(RECORD_HEADER_LEN);
      await this.fileHandle.read(headerBuf, 0, RECORD_HEADER_LEN, pos);
      const dv = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength);
      const recordLen = dv.getUint32(0, true);
      const expectedCrc = dv.getUint32(4, true);
      const type = headerBuf[8] as RecordType;

      if (type !== RECORD_TYPE_WRITE && type !== RECORD_TYPE_CHECKPOINT) {
        throw new WalCorruptError(`unknown record type ${type} at offset ${pos}`, pos);
      }
      if (recordLen < 1) {
        throw new WalCorruptError(`invalid record_length ${recordLen} at offset ${pos}`, pos);
      }

      // record_length includes the type byte: payloadLen = recordLen - 1.
      const payloadLen = recordLen - 1;
      const payloadStart = pos + RECORD_HEADER_LEN;
      const payloadEnd = payloadStart + payloadLen;

      if (payloadEnd > totalSize) {
        if (options.tolerateTrailingTruncation) return;
        throw new WalCorruptError(
          `truncated record payload at offset ${pos} (need ${payloadLen} bytes starting at ${payloadStart}, file ends at ${totalSize})`,
          pos,
        );
      }
      const payloadBuf = Buffer.alloc(payloadLen);
      if (payloadLen > 0) {
        await this.fileHandle.read(payloadBuf, 0, payloadLen, payloadStart);
      }

      // CRC is computed over (type_byte | payload_bytes), so
      // `crcInput` is `recordLen` bytes wide.
      const crcInput = new Uint8Array(recordLen);
      crcInput[0] = type;
      if (payloadLen > 0) crcInput.set(payloadBuf, 1);
      const actualCrc = Bun.hash.crc32(crcInput);
      if (actualCrc !== expectedCrc) {
        throw new WalCorruptError(
          `CRC mismatch at offset ${pos}: stored=${expectedCrc}, computed=${actualCrc}`,
          pos,
        );
      }

      const payload = new Uint8Array(payloadBuf.buffer, payloadBuf.byteOffset, payloadLen);
      callback({ type, payload, fileOffset: pos });

      // Advance to the next record. The full on-disk size is
      // RECORD_HEADER_LEN + payloadLen == 8 + recordLen.
      pos = payloadEnd;
    }
  }

  /** Current write position (i.e. file size as observed by this writer). */
  get position(): number {
    return this.writePosition;
  }

  // ---- internals ----

  private appendRecord(type: RecordType, payload: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Wal.append: closed'));
    if (!this.fileHandle) return Promise.reject(new Error('Wal.append: not open'));

    // Build a single contiguous record: 4 (length) + 4 (crc) + 1 (type) + payload.
    const recordLen = 1 + payload.byteLength;
    const crcInput = new Uint8Array(recordLen);
    crcInput[0] = type;
    if (payload.byteLength > 0) crcInput.set(payload, 1);
    const crc = Bun.hash.crc32(crcInput);

    const bytes = new Uint8Array(RECORD_HEADER_LEN + payload.byteLength);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, recordLen, true);
    dv.setUint32(4, crc, true);
    bytes[8] = type;
    if (payload.byteLength > 0) bytes.set(payload, RECORD_HEADER_LEN);

    return new Promise<void>((resolve, reject) => {
      this.pending.push({ bytes, resolve, reject });
      this.pendingBytes += bytes.byteLength;
      if (this.pendingBytes >= this.fsyncBytesThreshold) {
        this.cancelTimer();
        this.startFlushIfIdle();
      } else if (!this.flushTask && !this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = undefined;
          this.startFlushIfIdle();
        }, this.fsyncIntervalMs);
      }
    });
  }

  private cancelTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private startFlushIfIdle(): void {
    if (this.flushTask) return;
    this.flushTask = this.flushLoop().finally(() => {
      this.flushTask = undefined;
    });
    // Per-record rejections are delivered via the pending promises;
    // swallow the field-level rejection so unhandled-rejection logging
    // stays quiet.
    this.flushTask.catch(() => {
      /* delivered to callers via per-record promise */
    });
  }

  private async flushLoop(): Promise<void> {
    while (this.pending.length > 0) {
      if (!this.fileHandle) throw new Error('Wal: file handle closed mid-flush');
      const batch = this.pending;
      this.pending = [];
      this.pendingBytes = 0;

      let totalLen = 0;
      const buffers: Buffer[] = new Array(batch.length);
      for (let i = 0; i < batch.length; i++) {
        const b = (batch[i] as PendingWrite).bytes;
        buffers[i] = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
        totalLen += b.byteLength;
      }

      try {
        try {
          // Vectored write avoids concatenating into one Uint8Array per batch.
          // Position omitted → 'a+' appends to EOF.
          await this.fileHandle.writev(buffers);
        } catch (writevErr) {
          // Some runtimes lack writev — fall back to a single concatenated write.
          if (!(writevErr instanceof TypeError)) throw writevErr;
          const concat = new Uint8Array(totalLen);
          let off = 0;
          for (const w of batch) {
            concat.set(w.bytes, off);
            off += w.bytes.byteLength;
          }
          await this.fileHandle.write(concat, 0, concat.byteLength, null);
        }
        // datasync flushes file contents but not metadata — cheaper than sync()
        // and sufficient for durability of an append-only log.
        await this.fileHandle.datasync();
        this.writePosition += totalLen;
        for (const w of batch) w.resolve();
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        for (const w of batch) w.reject(err);
        throw err;
      }
    }
  }
}