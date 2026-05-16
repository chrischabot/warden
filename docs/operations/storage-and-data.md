# Storage and data

Warden owns its persistence. There is no external database, no external object store, no managed queue. Everything is files Warden writes to a local data directory.

## Data directory layout

```
$WARDEN_DATA_DIR/
├── queue/
│   ├── 0/                                  # queue shard 0
│   │   ├── segment-00000000000000000000.log
│   │   └── segment-00000000000000045231.log
│   ├── 1/
│   └── ...
├── columnar/
│   ├── 0/                                  # columnar shard 0
│   │   ├── wal-00000001.log
│   │   ├── seg-00000001.col
│   │   ├── seg-00000002.col
│   │   └── ...
│   ├── 1/
│   └── ...
└── meta/
    ├── shard-0.sqlite
    ├── shard-0.sqlite-wal
    ├── shard-0.sqlite-shm
    ├── shard-1.sqlite
    └── ...
```

Defaults (from `packages/queue-core` and `packages/columnar`):

- **Queue**: `maxSegmentBytes = 256 MiB`, `maxSegmentAgeMs = 1 h`. Segment names are `segment-<20-digit zero-padded base offset>.log`. Records are `[u32 length][u32 crc32][u8 type][payload]`.
- **Columnar WAL**: replayed on shard open; truncated on first MemTable seal that supersedes it.
- **Columnar segment**: zone-map block + N column blocks, each tagged with its `EncodingTag` (Raw, Dictionary, RunLength, DeltaForInt).

## How files are produced

### Queue

The relay enqueues to a queue shard. The shard's `SegmentedLog` appends to the active segment file, batches `fsync` calls (group commit, default 5 ms), and rolls the segment when it exceeds `maxSegmentBytes` or `maxSegmentAgeMs`.

Crash recovery: on open, the shard scans the active segment, validates CRC32 per record, finds the offset of the first byte that's not part of a complete record, and truncates there. If a flush failed at shutdown, the rejected batch's offsets are reused by the next append (the durable `recordCount` was never incremented).

### Columnar MemTable + WAL

The ingest worker writes each event into the columnar shard's MemTable (an in-memory column buffer). The MemTable is sealed when it hits one of:

- `maxRows = 250,000`
- `maxByteSize = 64 MiB`
- `maxAgeMs = 60,000` ms

On seal, the MemTable is handed to a compaction worker that writes a sealed segment file with per-column encodings + zone-maps, then truncates the WAL up to the seal point.

### Sealed segments

Sealed segments are append-only and never modified. Compaction merges multiple sealed segments into a larger compacted segment when the count crosses a threshold, then deletes the inputs.

Per-column encodings are chosen by the writer based on the data:

- **RLE** for low-cardinality strings (event level, environment, platform).
- **Dictionary** for medium-cardinality identifiers (release, transaction op).
- **Delta-for-frame-of-reference** for monotonically increasing int64 columns (timestamps).
- **Raw** for everything else (free-form strings, floats).

Each segment carries a zone-map: per-column min/max + null-count per block, used at query time to skip blocks whose range can't match the predicate. Empty columns omit zone-maps.

## Sizing

Rough estimate. Per-event compressed size in the columnar store ranges from **0.2 KB** (tight error event, no extras) to **2 KB** (transaction with 30 spans).

```
Storage per day  ≈ events_per_day × bytes_per_event_compressed × replication_factor
                = events_per_day × 1 KB                                            (sanity default)
```

So a host handling 10 events/s averages out to **864 MB/day**, ~26 GB/month, ~315 GB/year.

For the queue, allocate ~10× peak-second event volume. Queue segments are deleted as the consumer crosses them, so the steady-state queue footprint is small (minutes of buffer, not days).

Recommended disk floor: **200 GiB NVMe** even on a small box, so compaction always has headroom for "write the new segment then delete the inputs."

## Retention

Per-project retention is enforced in two places:

1. **Columnar reaper** — sealed segments whose max timestamp is older than `retention_days` are deleted in the compaction loop.
2. **Metadata GC** — issues, sessions, releases with no events newer than retention are pruned.

Set per-project retention in **Project settings → Data → Retention** in the UI, or via the admin API once it's wired. Default: 30 days for free-tier projects, 90 days for standard, configurable.

## Backup and restore

The data directory is a self-contained set of files. The mechanically safe way to back up Warden is:

1. **Pause writes** by stopping ingest workers (the relay can keep running; queue absorbs the burst).
2. **Snapshot** `$WARDEN_DATA_DIR` with your filesystem's atomic snapshot mechanism (LVM snapshot, ZFS snapshot, EBS snapshot, Btrfs snapshot).
3. **Resume** ingest workers.
4. **Replicate** the snapshot off-host.

If your filesystem doesn't support atomic snapshots, the safe alternative is:

1. Stop ingest workers.
2. `bun apps/admin/checkpoint.ts` — flushes all MemTables to sealed segments.
3. `tar -cf - $WARDEN_DATA_DIR | <ship somewhere>`.
4. Restart ingest workers.

Restore is the reverse: stop everything, untar, start. The WAL replay on open handles a partially-flushed state cleanly.

### What you don't need to back up

- WAL files. Regenerated from the next MemTable seal.
- `*.sqlite-wal` / `*.sqlite-shm` companions. SQLite recovers from the main `.sqlite` file alone if it was checkpointed before the snapshot. Force a checkpoint with `PRAGMA wal_checkpoint(TRUNCATE)` on each shard's main db connection.

## Migrating between hosts

The data directory is portable across hosts with identical Warden versions and topology (cores). Because shard count = cores, moving from a 16-core box to a 32-core box requires a resharding step — there is no automatic rebalancer. The pragmatic path is:

1. Stand up the new host with a fresh data directory.
2. Replay queue traffic into it (point your DSNs at the new host).
3. Decommission the old host after retention has expired.

Cross-host data migration (resharding) is on the roadmap.

## File-level gotchas

- **Symlinks**. Symlinking shards across volumes is supported but unwise: a shard's WAL and sealed segments must stay together on one filesystem for the recovery contract to hold.
- **NFS**. Don't. SQLite WAL mode has well-known issues over NFS; the queue's fsync semantics aren't reliable over NFS either.
- **Sparse files**. Warden does not use sparse files. `du` and `ls -l` agree.
- **Open file count**. Each sealed segment is one open fd during compaction or query. `ulimit -n` of 131,072 is recommended (see [Deployment](./deployment.md)).

## Where to read next

- [Internals: columnar store](../internals/columnar-store.md) — encodings, segment format, zone-maps.
- [Internals: queue](../internals/queue.md) — segmented log internals.
- [Observability](./observability.md) — what to alert on.
