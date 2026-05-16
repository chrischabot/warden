import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LogCorruptError,
  type LogRecord,
  RECORD_TYPE_CHECKPOINT,
  RECORD_TYPE_WRITE,
  SegmentedLog,
} from '../src/index';

let dir: string;
beforeEach(() => {
  dir = join(tmpdir(), `sr-queue-${randomUUID()}`);
});
afterEach(async () => {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function drain(log: SegmentedLog, from: bigint = 0n): Promise<LogRecord[]> {
  const out: LogRecord[] = [];
  for await (const r of log.read(from)) out.push(r);
  return out;
}

describe('SegmentedLog — basic append + read', () => {
  test('single record round-trips', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    const off = await log.append(new TextEncoder().encode('hello'));
    await log.close();
    expect(off).toBe(0n);

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    const records = await drain(reopen);
    await reopen.close();
    expect(records.length).toBe(1);
    expect(records[0]?.offset).toBe(0n);
    expect(new TextDecoder().decode(records[0]?.payload)).toBe('hello');
    expect(records[0]?.type).toBe(RECORD_TYPE_WRITE);
  });

  test('offsets are monotonic across many records', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    const offsets: bigint[] = [];
    for (let i = 0; i < 64; i++) {
      offsets.push(await log.append(new TextEncoder().encode(`r${i}`)));
    }
    await log.close();
    expect(offsets).toEqual(Array.from({ length: 64 }, (_, i) => BigInt(i)));

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    const records = await drain(reopen);
    await reopen.close();
    expect(records.length).toBe(64);
    for (let i = 0; i < 64; i++) {
      expect(records[i]?.offset).toBe(BigInt(i));
      expect(new TextDecoder().decode(records[i]?.payload)).toBe(`r${i}`);
    }
  });

  test('read(fromOffset) skips earlier records', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    for (let i = 0; i < 20; i++) {
      await log.append(new TextEncoder().encode(`r${i}`));
    }
    await log.close();

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    const records = await drain(reopen, 10n);
    await reopen.close();
    expect(records.length).toBe(10);
    expect(records[0]?.offset).toBe(10n);
    expect(records[9]?.offset).toBe(19n);
  });

  test('read with limit option stops early', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    for (let i = 0; i < 10; i++) {
      await log.append(new TextEncoder().encode(`r${i}`));
    }
    await log.close();
    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    const out: LogRecord[] = [];
    for await (const r of reopen.read(0n, { limit: 3 })) out.push(r);
    await reopen.close();
    expect(out.length).toBe(3);
  });
});

describe('SegmentedLog — segment rolling', () => {
  test('rolls when active segment exceeds maxSegmentBytes', async () => {
    // 9-byte header + 100-byte payload = 109 bytes per record.
    // maxSegmentBytes = 500 → roll after ~4-5 records.
    const log = new SegmentedLog({ dir, maxSegmentBytes: 500 });
    await log.open();
    expect(log.sealedSegmentCount).toBe(0);
    const payload = new Uint8Array(100);
    for (let i = 0; i < 12; i++) {
      payload.fill(i & 0xff);
      await log.append(payload);
    }
    await log.close();
    // 12 records × 109 bytes = 1308 bytes. With roll at 500, we'd
    // produce at least 2 sealed segments + 1 active = 3 files.
    const entries = await fs.readdir(dir);
    expect(entries.length).toBeGreaterThanOrEqual(3);
  });

  test('records survive rolling and replay in order', async () => {
    const log = new SegmentedLog({ dir, maxSegmentBytes: 300 });
    await log.open();
    for (let i = 0; i < 30; i++) {
      await log.append(new TextEncoder().encode(`rec-${i}`));
    }
    await log.close();

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    const records = await drain(reopen);
    await reopen.close();
    expect(records.length).toBe(30);
    for (let i = 0; i < 30; i++) {
      expect(records[i]?.offset).toBe(BigInt(i));
      expect(new TextDecoder().decode(records[i]?.payload)).toBe(`rec-${i}`);
    }
  });

  test('rolls when segment age exceeds maxSegmentAgeMs', async () => {
    const log = new SegmentedLog({
      dir,
      maxSegmentAgeMs: 25,
      // Don't roll on size — only on age.
      maxSegmentBytes: 1024 * 1024,
    });
    await log.open();
    await log.append(new TextEncoder().encode('first'));
    expect(log.sealedSegmentCount).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    // Next append triggers a post-flush roll check.
    await log.append(new TextEncoder().encode('second'));
    await log.close();
    const entries = (await fs.readdir(dir)).filter((n) => n.endsWith('.log'));
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  test('reading across rolled segments produces continuous offsets', async () => {
    const log = new SegmentedLog({ dir, maxSegmentBytes: 200 });
    await log.open();
    for (let i = 0; i < 20; i++) await log.append(new TextEncoder().encode(`x${i}`));
    await log.close();

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    const records = await drain(reopen, 5n);
    await reopen.close();
    expect(records.length).toBe(15);
    expect(records[0]?.offset).toBe(5n);
    expect(records[14]?.offset).toBe(19n);
  });
});

describe('SegmentedLog — recovery', () => {
  test('reopen preserves nextOffset after rolling', async () => {
    const log = new SegmentedLog({ dir, maxSegmentBytes: 200 });
    await log.open();
    for (let i = 0; i < 15; i++) await log.append(new TextEncoder().encode(`v${i}`));
    await log.close();

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    expect(reopen.nextOffset).toBe(15n);
    const newOffset = await reopen.append(new TextEncoder().encode('extra'));
    await reopen.close();
    expect(newOffset).toBe(15n);

    const final = new SegmentedLog({ dir });
    await final.open();
    const records = await drain(final);
    await final.close();
    expect(records.length).toBe(16);
    expect(records[15]?.offset).toBe(15n);
    expect(new TextDecoder().decode(records[15]?.payload)).toBe('extra');
  });

  test('partial trailing record is truncated on reopen', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    await log.append(new TextEncoder().encode('one'));
    await log.append(new TextEncoder().encode('two'));
    await log.close();

    // Corrupt the active segment by appending some garbage bytes
    // simulating a mid-write crash.
    const entries = (await fs.readdir(dir)).filter((n) => n.endsWith('.log'));
    const segName = entries[0] as string;
    const segPath = join(dir, segName);
    const fh = await fs.open(segPath, 'a');
    await fh.write(Buffer.from([0x05, 0x00])); // a header-shaped fragment
    await fh.close();

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    // The garbage tail was truncated; nextOffset reflects the two valid records.
    expect(reopen.nextOffset).toBe(2n);
    const newOff = await reopen.append(new TextEncoder().encode('three'));
    await reopen.close();
    expect(newOff).toBe(2n);

    const final = new SegmentedLog({ dir });
    await final.open();
    const records = await drain(final);
    await final.close();
    expect(records.length).toBe(3);
  });
});

describe('SegmentedLog — corruption detection', () => {
  test('CRC mismatch during read throws LogCorruptError', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    await log.append(new TextEncoder().encode('original'));
    await log.close();

    // Corrupt the payload byte (offset 9 = first byte of payload).
    const entries = (await fs.readdir(dir)).filter((n) => n.endsWith('.log'));
    const segPath = join(dir, entries[0] as string);
    const fh = await fs.open(segPath, 'r+');
    await fh.write(Buffer.from([0xff]), 0, 1, 9);
    await fh.close();

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    let err: unknown;
    try {
      for await (const _ of reopen.read()) {
        // never reached
      }
    } catch (e) {
      err = e;
    }
    await reopen.close();
    expect(err).toBeInstanceOf(LogCorruptError);
  });
});

describe('SegmentedLog — checkpoint records', () => {
  test('checkpoint round-trips with distinct type', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    await log.append(new TextEncoder().encode('w1'));
    await log.checkpoint(new TextEncoder().encode('cp'));
    await log.append(new TextEncoder().encode('w2'));
    await log.close();

    const reopen = new SegmentedLog({ dir });
    await reopen.open();
    const records = await drain(reopen);
    await reopen.close();
    expect(records.length).toBe(3);
    expect(records[0]?.type).toBe(RECORD_TYPE_WRITE);
    expect(records[1]?.type).toBe(RECORD_TYPE_CHECKPOINT);
    expect(records[2]?.type).toBe(RECORD_TYPE_WRITE);
  });
});

describe('SegmentedLog — group commit', () => {
  test('many concurrent appends complete and produce sequential offsets', async () => {
    const log = new SegmentedLog({
      dir,
      fsyncIntervalMs: 50,
      fsyncBytesThreshold: 1024 * 1024,
    });
    await log.open();
    const promises: Array<Promise<bigint>> = [];
    for (let i = 0; i < 200; i++) {
      promises.push(log.append(new TextEncoder().encode(`r${i}`)));
    }
    const offsets = await Promise.all(promises);
    await log.close();
    expect(offsets).toEqual(Array.from({ length: 200 }, (_, i) => BigInt(i)));
  });
});

describe('SegmentedLog — lifecycle', () => {
  test('rejects append after close', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    await log.close();
    let err: unknown;
    try {
      await log.append(new TextEncoder().encode('after-close'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
  });

  test('close is idempotent', async () => {
    const log = new SegmentedLog({ dir });
    await log.open();
    await log.append(new TextEncoder().encode('x'));
    await log.close();
    await log.close();
  });
});
