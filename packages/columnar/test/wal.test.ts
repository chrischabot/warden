import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WalRecord } from '../src/wal/index';
import { RECORD_TYPE_CHECKPOINT, RECORD_TYPE_WRITE, Wal, WalCorruptError } from '../src/wal/index';

let walPath: string;

beforeEach(() => {
  walPath = join(tmpdir(), `sr-wal-${randomUUID()}.log`);
});

afterEach(async () => {
  try {
    await fs.unlink(walPath);
  } catch {
    // ignore missing file
  }
});

describe('Wal — basic append + replay', () => {
  test('single record round trips', async () => {
    const wal = new Wal({ path: walPath, fsyncIntervalMs: 1 });
    await wal.open();
    const payload = new TextEncoder().encode('hello world');
    await wal.append(payload);
    await wal.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    const records: WalRecord[] = [];
    await reopened.replay((r) => records.push(r));
    await reopened.close();

    expect(records.length).toBe(1);
    expect(records[0]?.type).toBe(RECORD_TYPE_WRITE);
    expect(new TextDecoder().decode(records[0]?.payload)).toBe('hello world');
    expect(records[0]?.fileOffset).toBe(0);
  });

  test('multiple records preserved in order', async () => {
    const wal = new Wal({ path: walPath, fsyncIntervalMs: 1 });
    await wal.open();
    for (let i = 0; i < 32; i++) {
      await wal.append(new TextEncoder().encode(`record-${i}`));
    }
    await wal.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    const payloads: string[] = [];
    await reopened.replay((r) => payloads.push(new TextDecoder().decode(r.payload)));
    await reopened.close();
    for (let i = 0; i < 32; i++) {
      expect(payloads[i]).toBe(`record-${i}`);
    }
  });

  test('zero-length payloads work', async () => {
    const wal = new Wal({ path: walPath, fsyncIntervalMs: 1 });
    await wal.open();
    await wal.append(new Uint8Array(0));
    await wal.append(new TextEncoder().encode('after-empty'));
    await wal.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    const records: WalRecord[] = [];
    await reopened.replay((r) => records.push(r));
    await reopened.close();
    expect(records.length).toBe(2);
    expect(records[0]?.payload.byteLength).toBe(0);
    expect(new TextDecoder().decode(records[1]?.payload)).toBe('after-empty');
  });

  test('binary payloads with high-bit bytes survive', async () => {
    const bin = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bin[i] = i;
    const wal = new Wal({ path: walPath });
    await wal.open();
    await wal.append(bin);
    await wal.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    let got: Uint8Array | undefined;
    await reopened.replay((r) => {
      got = new Uint8Array(r.payload);
    });
    await reopened.close();
    expect(got).toEqual(bin);
  });
});

describe('Wal — checkpoint records', () => {
  test('checkpoint round-trips with distinct type', async () => {
    const wal = new Wal({ path: walPath });
    await wal.open();
    await wal.append(new TextEncoder().encode('write-1'));
    await wal.checkpoint(new TextEncoder().encode('cp-payload'));
    await wal.append(new TextEncoder().encode('write-2'));
    await wal.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    const records: WalRecord[] = [];
    await reopened.replay((r) => records.push(r));
    await reopened.close();

    expect(records.length).toBe(3);
    expect(records[0]?.type).toBe(RECORD_TYPE_WRITE);
    expect(records[1]?.type).toBe(RECORD_TYPE_CHECKPOINT);
    expect(new TextDecoder().decode(records[1]?.payload)).toBe('cp-payload');
    expect(records[2]?.type).toBe(RECORD_TYPE_WRITE);
  });
});

describe('Wal — group commit batching', () => {
  test('many concurrent appends batch into fewer fsyncs', async () => {
    const wal = new Wal({
      path: walPath,
      fsyncIntervalMs: 50,
      fsyncBytesThreshold: 1024 * 1024,
    });
    await wal.open();
    // Fire 100 appends without awaiting in between; they should all
    // batch into a single (or few) fsyncs by the timer.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(wal.append(new TextEncoder().encode(`r${i}`)));
    }
    await Promise.all(promises);
    await wal.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    const count = await countRecords(reopened);
    await reopened.close();
    expect(count).toBe(100);
  });

  test('byte-threshold triggers immediate flush', async () => {
    const wal = new Wal({
      path: walPath,
      fsyncIntervalMs: 60_000,
      fsyncBytesThreshold: 64,
    });
    await wal.open();
    // One large record (>64 bytes) should flush without waiting for timer.
    const big = new Uint8Array(256);
    const t0 = performance.now();
    await wal.append(big);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000); // well below the 60s timer
    await wal.close();
  });
});

describe('Wal — corruption detection', () => {
  test('CRC mismatch throws WalCorruptError', async () => {
    const wal = new Wal({ path: walPath });
    await wal.open();
    await wal.append(new TextEncoder().encode('clean'));
    await wal.close();

    // Corrupt one payload byte (offset 9 = first byte of payload).
    const fh = await fs.open(walPath, 'r+');
    const buf = Buffer.from([0xff]);
    await fh.write(buf, 0, 1, 9);
    await fh.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    let err: unknown;
    try {
      await reopened.replay(() => {
        // never reached
      });
    } catch (e) {
      err = e;
    }
    await reopened.close();
    expect(err).toBeInstanceOf(WalCorruptError);
  });

  test('truncated tail with tolerateTrailingTruncation succeeds', async () => {
    const wal = new Wal({ path: walPath });
    await wal.open();
    await wal.append(new TextEncoder().encode('good'));
    await wal.append(new TextEncoder().encode('also-good'));
    await wal.close();

    // Truncate the file by a few bytes to simulate mid-write crash.
    const stat = await fs.stat(walPath);
    const fh = await fs.open(walPath, 'r+');
    await fh.truncate(stat.size - 3);
    await fh.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    const seen: string[] = [];
    await reopened.replay((r) => seen.push(new TextDecoder().decode(r.payload)), {
      tolerateTrailingTruncation: true,
    });
    await reopened.close();
    // First record is whole; second was truncated → not yielded.
    expect(seen).toEqual(['good']);
  });

  test('truncated tail without tolerance throws', async () => {
    const wal = new Wal({ path: walPath });
    await wal.open();
    await wal.append(new TextEncoder().encode('one'));
    await wal.append(new TextEncoder().encode('two'));
    await wal.close();

    const stat = await fs.stat(walPath);
    const fh = await fs.open(walPath, 'r+');
    await fh.truncate(stat.size - 2);
    await fh.close();

    const reopened = new Wal({ path: walPath });
    await reopened.open();
    let err: unknown;
    try {
      await reopened.replay(() => {
        // ignore
      });
    } catch (e) {
      err = e;
    }
    await reopened.close();
    expect(err).toBeInstanceOf(WalCorruptError);
  });
});

describe('Wal — lifecycle', () => {
  test('rejects append after close', async () => {
    const wal = new Wal({ path: walPath });
    await wal.open();
    await wal.close();
    let err: unknown;
    try {
      await wal.append(new TextEncoder().encode('nope'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
  });

  test('reopen after close preserves records', async () => {
    const wal1 = new Wal({ path: walPath });
    await wal1.open();
    await wal1.append(new TextEncoder().encode('persistent'));
    await wal1.close();

    const wal2 = new Wal({ path: walPath });
    await wal2.open();
    await wal2.append(new TextEncoder().encode('appended-later'));
    await wal2.close();

    const reader = new Wal({ path: walPath });
    await reader.open();
    const payloads: string[] = [];
    await reader.replay((r) => payloads.push(new TextDecoder().decode(r.payload)));
    await reader.close();
    expect(payloads).toEqual(['persistent', 'appended-later']);
  });

  test('sync() forces an immediate flush', async () => {
    const wal = new Wal({
      path: walPath,
      fsyncIntervalMs: 60_000,
      fsyncBytesThreshold: 1024 * 1024,
    });
    await wal.open();
    const p = wal.append(new TextEncoder().encode('forced'));
    await wal.sync();
    await p; // must already be resolved
    await wal.close();

    const stat = await fs.stat(walPath);
    expect(stat.size).toBeGreaterThan(0);
  });
});

async function countRecords(wal: Wal): Promise<number> {
  let count = 0;
  await wal.replay(() => {
    count++;
  });
  return count;
}
