/**
 * SegmentedLog — append-only log split across rolling segment files.
 *
 * Files in the data directory follow the pattern
 *   `segment-<20-digit zero-padded base offset>.log`
 * and contain a concatenation of records (see types.ts for layout).
 *
 * Lifecycle:
 *   - `open()` creates the directory if missing, scans for existing
 *     `segment-*.log` files, identifies the active segment (highest
 *     base offset), and runs crash-recovery on it: it scans valid
 *     records, finds the offset of the first byte that's not part
 *     of a complete record, and truncates the file there so the
 *     next append doesn't follow a partial record.
 *   - `append(payload)` enqueues the payload for group-commit
 *     fsync; returns the offset the record will land at.
 *   - When the active segment exceeds `maxSegmentBytes` or
 *     `maxSegmentAgeMs`, it's rolled at the next flush boundary:
 *     the current file is closed and moved to the sealed list, a
 *     new active segment is opened at the next base offset.
 *   - `read(fromOffset)` walks the records in order across all
 *     segments, validating CRCs.
 *   - `close()` flushes any pending writes and releases handles.
 *
 * Failure model: if a flush fails, the pending writers are
 * rejected and their offsets remain "burned" — i.e. the durable
 * `recordCount` is not incremented for that batch, so subsequent
 * appends reuse the offsets the rejected batch had been assigned.
 * Consumers reading the log after a flush failure see no record
 * at the failed offsets because nothing was ever durable there.
 */

import type { FileHandle } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  LogCorruptError,
  type LogRecord,
  RECORD_HEADER_LEN,
  RECORD_TYPE_CHECKPOINT,
  RECORD_TYPE_WRITE,
  type ReadOptions,
  type RecordType,
  type SegmentedLogConfig,
} from './types';

const DEFAULT_MAX_SEGMENT_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_SEGMENT_AGE_MS = 60 * 60 * 1000;
const DEFAULT_FSYNC_INTERVAL_MS = 5;
const DEFAULT_FSYNC_BYTES = 256 * 1024;
const SEGMENT_NAME_RE = /^segment-(\d{1,20})\.log$/;
const OFFSET_PAD = 20;

interface PendingWrite {
  readonly bytes: Uint8Array;
  readonly offset: bigint;
  readonly resolve: (offset: bigint) => void;
  readonly reject: (err: Error) => void;
}

interface SegmentRef {
  readonly baseOffset: bigint;
  readonly filePath: string;
}

interface ActiveSegment {
  baseOffset: bigint;
  filePath: string;
  fileHandle: FileHandle;
  recordCount: bigint;
  bytesWritten: number;
  createdAt: number;
}

export class SegmentedLog {
  private readonly maxSegmentBytes: number;
  private readonly maxSegmentAgeMs: number;
  private readonly fsyncIntervalMs: number;
  private readonly fsyncBytesThreshold: number;
  private sealedSegments: SegmentRef[] = [];
  private active: ActiveSegment | undefined;
  private pending: PendingWrite[] = [];
  private pendingBytes = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushTask: Promise<void> | undefined;
  private closed = false;

  constructor(public readonly config: SegmentedLogConfig) {
    this.maxSegmentBytes = config.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES;
    this.maxSegmentAgeMs = config.maxSegmentAgeMs ?? DEFAULT_MAX_SEGMENT_AGE_MS;
    this.fsyncIntervalMs = config.fsyncIntervalMs ?? DEFAULT_FSYNC_INTERVAL_MS;
    this.fsyncBytesThreshold = config.fsyncBytesThreshold ?? DEFAULT_FSYNC_BYTES;
  }

  /** Open the log directory and recover the active segment. */
  async open(): Promise<void> {
    if (this.active) return;
    await fs.mkdir(this.config.dir, { recursive: true });

    const entries = await fs.readdir(this.config.dir);
    const segs: SegmentRef[] = [];
    for (const name of entries) {
      const m = SEGMENT_NAME_RE.exec(name);
      if (!m) continue;
      const base = BigInt(m[1] as string);
      segs.push({ baseOffset: base, filePath: path.join(this.config.dir, name) });
    }
    segs.sort((a, b) => (a.baseOffset < b.baseOffset ? -1 : a.baseOffset > b.baseOffset ? 1 : 0));

    if (segs.length === 0) {
      // Empty directory: create the first segment at offset 0.
      const baseOffset = 0n;
      const filePath = this.segmentPath(baseOffset);
      const fh = await fs.open(filePath, 'a+');
      this.active = {
        baseOffset,
        filePath,
        fileHandle: fh,
        recordCount: 0n,
        bytesWritten: 0,
        createdAt: Date.now(),
      };
      return;
    }

    // All but the last are sealed.
    this.sealedSegments = segs.slice(0, -1);
    const last = segs[segs.length - 1] as SegmentRef;
    await this.openActiveWithRecovery(last);
  }

  /** Append a payload. Resolves with the offset where it landed. */
  async append(payload: Uint8Array): Promise<bigint> {
    return this.appendRecord(RECORD_TYPE_WRITE, payload);
  }

  /** Append a CHECKPOINT record. */
  async checkpoint(payload: Uint8Array = new Uint8Array(0)): Promise<bigint> {
    return this.appendRecord(RECORD_TYPE_CHECKPOINT, payload);
  }

  /** Force any pending writes to flush + fsync now. */
  async sync(): Promise<void> {
    this.cancelTimer();
    this.startFlushIfIdle();
    if (this.flushTask) await this.flushTask;
  }

  /** Flush + fsync any pending writes, then close handles. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sync();
    if (this.active) {
      await this.active.fileHandle.close();
      this.active = undefined;
    }
  }

  /** Offset the next appended record will land at. */
  get nextOffset(): bigint {
    if (!this.active) return 0n;
    return this.active.baseOffset + this.active.recordCount + BigInt(this.pending.length);
  }

  /** Number of sealed segments. */
  get sealedSegmentCount(): number {
    return this.sealedSegments.length;
  }

  /** Read records from `fromOffset` inclusive. */
  async *read(
    fromOffset: bigint = 0n,
    options: ReadOptions = {},
  ): AsyncGenerator<LogRecord, void, void> {
    if (!this.active) throw new Error('SegmentedLog.read: not open');
    const tolerate = options.tolerateTrailingTruncation ?? true;
    let yielded = 0;
    const limit = options.limit;
    // Snapshot the segment list at call time. The active segment's
    // size may grow during reads — we cap reads at the size as of
    // the moment we open each segment's read handle.
    const allSegments: SegmentRef[] = [
      ...this.sealedSegments,
      { baseOffset: this.active.baseOffset, filePath: this.active.filePath },
    ];
    let from = fromOffset;
    for (let i = 0; i < allSegments.length; i++) {
      const seg = allSegments[i] as SegmentRef;
      const next = allSegments[i + 1];
      const nextBase = next ? next.baseOffset : null;
      if (nextBase !== null && from >= nextBase) {
        // Entirely past this segment, skip.
        continue;
      }
      for await (const rec of this.readSegment(
        seg,
        from < seg.baseOffset ? seg.baseOffset : from,
        tolerate,
      )) {
        yield rec;
        yielded++;
        if (limit !== undefined && yielded >= limit) return;
      }
      // For subsequent segments, no in-segment skip is needed.
      from = -1n;
    }
  }

  // ---- internals ----

  private appendRecord(type: RecordType, payload: Uint8Array): Promise<bigint> {
    if (this.closed) return Promise.reject(new Error('SegmentedLog.append: closed'));
    if (!this.active) return Promise.reject(new Error('SegmentedLog.append: not open'));

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

    // Offset assignment: the next-pending slot in the current active segment.
    const offset = this.active.baseOffset + this.active.recordCount + BigInt(this.pending.length);

    return new Promise<bigint>((resolve, reject) => {
      this.pending.push({ bytes, offset, resolve, reject });
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
    this.flushTask.catch(() => {
      /* per-record rejections already delivered */
    });
  }

  private async flushLoop(): Promise<void> {
    while (this.pending.length > 0 && this.active) {
      const batch = this.pending;
      this.pending = [];
      this.pendingBytes = 0;

      let totalLen = 0;
      for (const w of batch) totalLen += w.bytes.byteLength;
      const concat = new Uint8Array(totalLen);
      let off = 0;
      for (const w of batch) {
        concat.set(w.bytes, off);
        off += w.bytes.byteLength;
      }

      try {
        await this.active.fileHandle.write(concat, 0, concat.byteLength, null);
        await this.active.fileHandle.sync();
        this.active.bytesWritten += concat.byteLength;
        this.active.recordCount += BigInt(batch.length);
        for (const w of batch) w.resolve(w.offset);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        for (const w of batch) w.reject(err);
        throw err;
      }

      // Post-flush roll check.
      if (this.shouldRoll()) {
        await this.rollSegment();
      }
    }
  }

  private shouldRoll(): boolean {
    if (!this.active) return false;
    return (
      this.active.bytesWritten >= this.maxSegmentBytes ||
      Date.now() - this.active.createdAt >= this.maxSegmentAgeMs
    );
  }

  private async rollSegment(): Promise<void> {
    if (!this.active) return;
    const old = this.active;
    await old.fileHandle.close();
    this.sealedSegments.push({ baseOffset: old.baseOffset, filePath: old.filePath });
    const newBase = old.baseOffset + old.recordCount;
    const newPath = this.segmentPath(newBase);
    const fh = await fs.open(newPath, 'a+');
    this.active = {
      baseOffset: newBase,
      filePath: newPath,
      fileHandle: fh,
      recordCount: 0n,
      bytesWritten: 0,
      createdAt: Date.now(),
    };
  }

  private segmentPath(baseOffset: bigint): string {
    const padded = baseOffset.toString().padStart(OFFSET_PAD, '0');
    return path.join(this.config.dir, `segment-${padded}.log`);
  }

  /**
   * Open the last segment with crash-recovery. Scans its records
   * until it finds the first incomplete one, truncates the file
   * there, and resumes appending from that point.
   */
  private async openActiveWithRecovery(seg: SegmentRef): Promise<void> {
    // First pass: open r+ to allow truncation if a partial record
    // is detected at the tail.
    const recoverHandle = await fs.open(seg.filePath, 'r+');
    const stat = await recoverHandle.stat();
    const totalSize = stat.size;
    let pos = 0;
    let count = 0n;
    while (pos < totalSize) {
      if (pos + RECORD_HEADER_LEN > totalSize) break;
      const headerBuf = Buffer.alloc(RECORD_HEADER_LEN);
      await recoverHandle.read(headerBuf, 0, RECORD_HEADER_LEN, pos);
      const dv = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength);
      const recordLen = dv.getUint32(0, true);
      const payloadLen = recordLen - 1;
      if (recordLen < 1 || pos + RECORD_HEADER_LEN + payloadLen > totalSize) break;
      // We don't CRC-validate during recovery: a CRC mismatch on a
      // recovered record is corruption, but recovery is best-effort —
      // we just stop scanning and truncate at the last good record.
      // The read path validates CRCs and reports corruption.
      pos += RECORD_HEADER_LEN + payloadLen;
      count++;
    }
    if (pos < totalSize) {
      await recoverHandle.truncate(pos);
    }
    await recoverHandle.close();

    const fh = await fs.open(seg.filePath, 'a+');
    this.active = {
      baseOffset: seg.baseOffset,
      filePath: seg.filePath,
      fileHandle: fh,
      recordCount: count,
      bytesWritten: pos,
      createdAt: Date.now(),
    };
  }

  private async *readSegment(
    seg: SegmentRef,
    fromOffset: bigint,
    tolerate: boolean,
  ): AsyncGenerator<LogRecord, void, void> {
    const fh = await fs.open(seg.filePath, 'r');
    try {
      const stat = await fh.stat();
      const totalSize = stat.size;
      let pos = 0;
      let recordIdx = 0n;
      while (pos < totalSize) {
        const offset = seg.baseOffset + recordIdx;
        if (pos + RECORD_HEADER_LEN > totalSize) {
          if (tolerate) return;
          throw new LogCorruptError(
            `truncated record header at offset ${offset} (file ${seg.filePath})`,
            offset,
            seg.filePath,
          );
        }
        const headerBuf = Buffer.alloc(RECORD_HEADER_LEN);
        await fh.read(headerBuf, 0, RECORD_HEADER_LEN, pos);
        const dv = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength);
        const recordLen = dv.getUint32(0, true);
        const expectedCrc = dv.getUint32(4, true);
        const type = headerBuf[8] as RecordType;
        if (type !== RECORD_TYPE_WRITE && type !== RECORD_TYPE_CHECKPOINT) {
          throw new LogCorruptError(
            `unknown record type ${type} at offset ${offset}`,
            offset,
            seg.filePath,
          );
        }
        if (recordLen < 1) {
          throw new LogCorruptError(
            `invalid record_length ${recordLen} at offset ${offset}`,
            offset,
            seg.filePath,
          );
        }
        const payloadLen = recordLen - 1;
        const payloadStart = pos + RECORD_HEADER_LEN;
        const payloadEnd = payloadStart + payloadLen;
        if (payloadEnd > totalSize) {
          if (tolerate) return;
          throw new LogCorruptError(`truncated payload at offset ${offset}`, offset, seg.filePath);
        }
        const payloadBuf = Buffer.alloc(payloadLen);
        if (payloadLen > 0) {
          await fh.read(payloadBuf, 0, payloadLen, payloadStart);
        }
        const crcInput = new Uint8Array(recordLen);
        crcInput[0] = type;
        if (payloadLen > 0) crcInput.set(payloadBuf, 1);
        const actualCrc = Bun.hash.crc32(crcInput);
        if (actualCrc !== expectedCrc) {
          throw new LogCorruptError(
            `CRC mismatch at offset ${offset}: stored=${expectedCrc} computed=${actualCrc}`,
            offset,
            seg.filePath,
          );
        }

        if (offset >= fromOffset || fromOffset < 0n) {
          const payload = new Uint8Array(payloadBuf.buffer, payloadBuf.byteOffset, payloadLen);
          yield {
            offset,
            type,
            payload,
            segmentBaseOffset: seg.baseOffset,
            fileOffset: pos,
          };
        }

        pos = payloadEnd;
        recordIdx++;
      }
    } finally {
      await fh.close();
    }
  }
}
