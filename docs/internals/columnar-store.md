# Columnar event store

Source: [`packages/columnar/`](../../packages/columnar/).

The columnar store is Warden's primary data home. Events, transactions, logs, profiles, metrics all land here, partitioned into shards by `hash(project_id, group_hash)`. One MemTable per shard, sealed segments per shard on disk.

## Subdirectories

```
packages/columnar/src/
├── bit-buffer.ts        # bit-packed buffer primitive
├── encodings/           # raw, dictionary, run-length, delta-for-int
├── memtable/            # in-memory column buffer
├── wal/                 # write-ahead log
├── segment/             # sealed segment reader/writer + zone-map
├── query/               # planner + executor + predicate pushdown
├── compaction/          # merge sealed → compacted
├── cache/               # hot-page LRU
├── metrics.ts           # sr_columnar_* gauges and histograms
└── types.ts             # column types, encoding tags
```

## Column types

```ts
type ColumnType = "int32" | "int64" | "uint32" | "float64" | "string" | "binary";
```

`int64` columns are stored as `f64` internally — safe for the millisecond-resolution timestamps Warden writes, but be aware when adding a non-timestamp int64 column whose values exceed 2^53.

## Encodings

```ts
enum EncodingTag {
  Raw          = 0,
  Dictionary   = 1,
  RunLength    = 2,
  DeltaForInt  = 3,
}
```

The writer chooses per-page based on the page's data:

- **Raw** — free-form strings, floats, anything high-entropy.
- **Dictionary** — medium-cardinality identifiers (release, transaction op, environment).
- **RunLength** — low-cardinality strings (level, platform).
- **DeltaFor** (delta-for-frame-of-reference) — monotonically increasing int64 columns (timestamps).

Each page is independently decodable. A query can decode one column without touching the others.

## MemTable

The in-memory column buffer for an active shard. Defaults:

```ts
maxRows     = 250_000
maxByteSize = 64 * 1024 * 1024
maxAgeMs    = 60_000
```

When any limit is hit the MemTable seals: it stops accepting writes, the WAL is checkpointed past the seal point, and a compaction worker flushes the MemTable to a sealed segment on disk. A fresh MemTable replaces it.

The MemTable carries a row count, a byte-size estimate, and a wall-clock age. Writes are O(1) appends per column.

## WAL

The write-ahead log lives next to the active MemTable on disk:

```
columnar/<shard>/wal-<id>.log
```

Records are CRC-validated. On shard open the WAL is replayed to reconstruct the MemTable. On MemTable seal the WAL is truncated up to the seal point.

The WAL is what makes ingest crash-safe: a crash between the relay enqueue and the MemTable flush is recovered by the queue (the unconsumed records replay); a crash between the MemTable append and the seal is recovered by the WAL replay.

## Segment file

A sealed segment file (`columnar/<shard>/seg-<id>.col`) is:

```
[ zone-map block ]
[ column 0 page 0 ] [ column 0 page 1 ] ...
[ column 1 page 0 ] [ column 1 page 1 ] ...
...
[ footer (offsets, counts, schema) ]
```

Each page is tagged with its `EncodingTag`. The zone-map block has, per column per page:

- `min`
- `max`
- `null_count`

A query whose predicate is `timestamp >= T0 AND timestamp < T1` can skip every page whose `(min, max)` is outside `[T0, T1)`. Pages whose zone-map says `null_count = page_size` are skipped for `IS NOT NULL` predicates.

Empty columns omit their zone-map to save bytes.

## Query

The query path is:

1. **Plan**: rewrite predicates, push down to zone-map prunes.
2. **Plan**: pick a shard list (today, all shards; future, predicate-pruned).
3. **Execute per shard**:
   - For each sealed segment, prune pages by zone-map.
   - For surviving pages, decode the column(s) the query needs.
   - Apply predicates.
   - Aggregate / project.
4. **Merge** results across shards (scatter-gather).

The cache layer holds hot pages decoded in memory (`packages/columnar/src/cache/`). MemTable rows are queried in place without serialization cost.

`sr_columnar_zonemap_prune_ratio` measures the fraction of pages skipped — a good zone-map hit rate keeps queries fast even as data volume grows.

## Compaction

Compactors run continuously:

1. List sealed segments per shard.
2. When the count crosses a threshold, pick a set to merge.
3. Read input segments, merge-sort by primary column (typically timestamp), rewrite as a single compacted segment with fresh zone-maps.
4. Once the new segment is durable, delete the inputs.

The compactor never overwrites: new segments first, deletes last. A crash mid-compaction leaves the inputs in place; the next compaction picks them up.

`sr_columnar_compaction_lag_seconds` measures how far behind compaction is.

## Retention

Per-project retention is enforced during compaction: input segments whose max-timestamp is older than the project's retention window are dropped entirely, not rewritten. So old data falls off as compactors run.

## Where to read next

- [Operations: storage and data](../operations/storage-and-data.md) for disk layout and sizing.
- [`packages/columnar/src/`](../../packages/columnar/src/) — the source. Each subdirectory has a top-level comment explaining its role.
