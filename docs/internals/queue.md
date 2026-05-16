# Queue

Source: [`packages/queue-core/`](../../packages/queue-core/).

A segmented append-only log on local disk. The relay appends; ingest workers tail. No external broker.

## Files

```
queue/<shard_id>/segment-<20-digit zero-padded base offset>.log
```

The leading zeros are deliberate — they let `ls -1` sort lexically by base offset, which matches numeric order up to `10^20 - 1`.

## Record format

Each record is:

```
[u32 length] [u32 crc32] [u8 type] [payload bytes...]
```

Total header: 9 bytes. `crc32` covers the payload only. `type` discriminates `data`, `checkpoint`, `meta`.

## Lifecycle

### Open

`SegmentedLog.open(config)`:

1. Create the data directory if missing.
2. Scan for existing `segment-*.log`.
3. Identify the active segment (highest base offset).
4. Run **crash recovery**: scan valid records in the active segment, find the offset of the first byte that is not part of a complete record, and `truncate()` there.
5. Return a handle that knows the current `recordCount` and head offset.

After open, the log is consistent: every byte before `recordCount` is part of a fully durable record, and every byte after has been truncated.

### Append

`append(payload)`:

1. Enqueue the payload for the next group-commit flush.
2. Return the offset the record will land at (assigned immediately).
3. The group-commit goroutine fsyncs the batch (default every 5 ms or 1 MiB, whichever first).
4. If the flush succeeds, durable `recordCount` is incremented.
5. If the flush fails, the rejected batch's offsets are **burned** — `recordCount` is not incremented, and the next append reuses those offsets.

This means consumers reading past a failed flush never see a record at the burned offsets (the bytes might be there on disk, but no consumer ever advances past them because the durable count never went up).

### Roll

When the active segment exceeds `maxSegmentBytes` (default 256 MiB) or `maxSegmentAgeMs` (default 1 h), at the next flush boundary:

1. Close the current segment.
2. Move it to the sealed list.
3. Open a new active segment at the next base offset.

Rolls happen at flush boundaries so they don't split a record across segments.

### Read

`read(fromOffset)`:

- Walks records in order across segments.
- Validates CRC32 on each record.
- On a corrupt record, logs to `sr_queue_crc_failures_total` and skips (or fails the consumer, per consumer config).

The consumer manages its offset; offsets survive restarts.

### Close

`close()`:

1. Flush pending writes.
2. Release file handles.

Subsequent appends fail; the log can be reopened.

## Config

```ts
interface SegmentedLogConfig {
  dir: string;
  maxSegmentBytes?: number;        // default 256 MiB
  maxSegmentAgeMs?: number;        // default 1 h
  flushIntervalMs?: number;        // default 5 ms
  flushBatchBytes?: number;        // default 1 MiB
}
```

## Why this and not Kafka

- **Operational surface**. Kafka is an entire system to run alongside Warden. The queue is a few hundred lines of code in `packages/queue-core/`.
- **Durability you can reason about**. CRC32 + fsync + recovery-on-open is the entire story.
- **Throughput**. Sequential append-only files saturate NVMe write throughput. We don't beat Kafka on cross-host replication, but we don't need to — Warden is single-host today and partition-per-host scales horizontally.
- **Cost**. Zero.

## Limits

- **Single host**. Cross-host replication is not in scope. To run Warden in HA, run two independent hosts behind a DSN allocator and accept dual-write.
- **Linear scan on recovery**. A 10 GiB segment takes seconds to scan. Keep `maxSegmentBytes` reasonable.

## Where to read next

- [`packages/queue-core/src/log.ts`](../../packages/queue-core/src/log.ts) — the implementation, with a long top comment.
- [Operations: storage and data](../operations/storage-and-data.md) for backup and retention.
