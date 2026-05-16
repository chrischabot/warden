# Architecture

Warden is a multi-process Bun application. Each process kind has a single responsibility and is sized from the host's logical core count at boot. The supervisor that spawns them is intentionally outside Warden — you point systemd, supervisord, or a container orchestrator at the entrypoints and Warden tells you, via `packages/topology`, how many of each to run.

## Process model

```
                ┌────────────────────────────────────────────────┐
                │              Supervisor (systemd / pm)         │
                └────────────────────────────────────────────────┘
                              │       │       │
              ┌───────────────┼───────┼───────┼───────────────────┐
              │               │       │       │                   │
              ▼               ▼       ▼       ▼                   ▼
       Relay procs N×   Ingest workers   Compactors    Query workers
       (Bun.serve,      (queue → group   (MemTable     (scatter-gather
        reusePort)       → store)         → segments)   across shards)
              │               │       │       │                   │
              ▼               ▼       ▼       ▼                   ▼
        ┌─────────────────────────────────────────────────────────┐
        │                   Local disk (data dir)                  │
        │  queue segments │ columnar segments │ sqlite metadata    │
        └─────────────────────────────────────────────────────────┘
```

Process kinds (every count is computed from `cores`):

| Kind                | Count formula                  | What it does                                                                                  |
| ------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `relay`             | `max(2, cores / 8)`            | Accept envelopes over HTTP, authenticate, rate-limit, scrub PII, dynamic-sample, enqueue.     |
| `ingest`            | `max(1, cores / 4)`            | Consume queue, parse + fingerprint events, write to columnar MemTable.                        |
| `compaction`        | `max(1, cores / 4)`            | Merge sealed MemTables into compacted segments, rewrite zone-maps.                            |
| `query`             | `max(1, cores / 4)`            | Execute Discover/dashboard queries by scatter-gather across columnar shards.                  |
| `api`               | `max(2, cores / 8)`            | Read-side HTTP API for the web UI and external API consumers.                                 |
| `ws-fanout`         | (per topology)                 | WebSocket fan-out for live event streams in the UI.                                            |
| `alert-coordinator` | 1                              | Owns alert rule scheduling.                                                                    |
| `alert-evaluator`   | `max(4, ceil(projects/100))`   | Evaluates metric/issue alert rules against the columnar store and emits notifications.        |
| `cron-leader`       | 1                              | Tracks expected cron check-ins, emits missed-check-in events.                                  |
| `uptime-prober`     | `max(2, ceil(monitors/500))`   | HTTP/TCP probes from the platform out to your services.                                       |
| `seer`              | (per topology)                 | ML heuristics for anomaly detection on metrics and error spikes.                              |

Exact counts come from `computeTopology({ cores })` in [`packages/topology`](../packages/topology/src/index.ts). `summarize(computeTopology({ cores: 32 }))` returns the full breakdown for a 32-core host.

## Data flow

A captured event flows like this:

1. **SDK** builds an Event, applies the merged Scope, encodes the envelope, and POSTs to `<dsn-derived envelope URL>`.
2. **Relay** authenticates the DSN, streams the envelope body item by item:
   - Rate-limit by `(project_id, data_category)`.
   - PII scrub JSON items (never attachment bodies).
   - Dynamic-sample (deterministic on `trace_id` if present).
   - Enqueue each accepted item onto the topic `<project_id>:<item_type>`.
   - Record an `Outcome` for every item, accepted or dropped.
   Response is `200 {accepted, rate_limited, filtered}` (or `429` if globally rate-limited).
3. **Queue** appends the item to a segmented log on local disk with group-commit fsync. CRC32 per record, segment files roll on size or age.
4. **Ingest worker** consumes its queue shard, fingerprints the event (in-app frames + exception type/value, or the user override), computes the 16-hex group hash, and writes the event into the columnar shard for `(project_id, hash)`.
5. **Columnar store** appends to a MemTable; when the MemTable hits `maxRows=250k`, `maxByteSize=64 MiB`, or `maxAgeMs=60s`, it seals and a **compaction worker** flushes it to a segment file with per-column encodings and zone-maps.
6. **Query workers** read sealed segments, prune by zone-map predicates, decode columns, and return result rows to the API.

The MemTable, WAL, and sealed segments per shard live on local disk under the data directory. Nothing crosses the network between ingest and store; everything is process-local.

## How Warden uses every core

Three mechanisms together saturate a multi-core box without thread pools.

### 1. Process fan-out by topology

For each process kind, Warden assumes the supervisor runs N copies. N is computed once, at supervisor startup, from `os.cpus().length`. On a 64-core box that's ~171 processes. The OS scheduler handles core affinity.

### 2. Shared HTTP port

Multiple relay processes bind the same port using `reusePort: true` on `Bun.serve`. The kernel load-balances incoming TCP connections across the SO_REUSEPORT group, so adding relay processes scales accept throughput linearly until you hit network bandwidth.

### 3. Shard partitioning

Columnar storage is partitioned into `cores` shards keyed by `hash(project_id, group_hash)`. Queue topics are partitioned into `max(1, cores/4)` shards with one ingest worker per shard — so each shard has exactly one consumer. Metadata SQLite is sharded into `max(1, cores/4)` databases by `(org_id, project_id)`. Compactors and query workers stripe across columnar shards by index.

Net result: writes parallelize by hash; reads parallelize by scatter-gather; nothing contends on a global lock.

## State

What lives where:

- **Queue segments** — `<data_dir>/queue/<shard_id>/segment-<offset>.log`. Sequential append, fsync-batched, CRC32 per record. Read by byte offset; offsets survive restarts.
- **Columnar segments** — `<data_dir>/columnar/<shard_id>/seg-<id>.col`. Sealed, immutable, encoded per column (RLE / dictionary / delta-for / raw), prefaced by a zone-map block.
- **WAL** — `<data_dir>/columnar/<shard_id>/wal-<id>.log`. Replayed on shard open to recover the MemTable.
- **Metadata** — `<data_dir>/meta/shard-<index>.sqlite`. SQLite WAL mode. Holds orgs, projects, project keys, issues, releases, alert rules, cron monitors, uptime monitors, audit log.

See [Storage and data](./operations/storage-and-data.md) for backup, retention, and disk-sizing guidance.

## Self-observability

Every process registers metrics in the `sr_*` Prometheus namespace:

- `sr_relay_envelopes_total{project,outcome}` — envelope items accepted/dropped by reason.
- `sr_queue_segment_size_bytes`, `sr_queue_append_latency_seconds` — queue health.
- `sr_columnar_memtable_rows`, `sr_columnar_compaction_duration_seconds` — store health.
- `sr_ingest_event_loop_lag_seconds` — event-loop saturation per ingest worker.

The same buckets (`LATENCY_BUCKETS`, `SIZE_BUCKETS`) are reused everywhere so dashboards work across processes. See [Operations: observability](./operations/observability.md).

## Performance ceiling

Measured on a 2 vCPU / 8 GiB sandbox: **14,268 events/s sustained** end-to-end over a 20,000-event burst, 100 % accuracy across errors / transactions / logs, event-loop lag p95 = 26.78 ms, peak RSS delta = 92 MiB. The spec ceiling at 32 cores is 10k events/s sustained and ~25k peak.
