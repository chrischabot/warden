# Scaling and topology

Warden's process counts are derived dynamically from the host's logical core count. The same binary scales from a 4-core laptop to a 64-core production box with no per-environment configuration. The single source of truth is [`packages/topology`](../../packages/topology/src/index.ts).

## The formulas

Every count uses `max(<floor>, <formula>)` so a 1-core box still has at least one of everything.

| Process kind        | Formula                          | Why                                                                                 |
| ------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `relayProcs`        | `max(2, floor(cores / 8))`       | One JS event loop per relay; floor of 2 for HA.                                     |
| `columnarShards`    | `cores`                          | One shard per core; partitions writes by `hash(project_id, group_hash)`.            |
| `queueShards`       | `max(1, floor(cores / 4))`       | Each queue shard has exactly one consumer.                                          |
| `metadataShards`    | `max(1, floor(cores / 4))`       | SQLite files sharded by `(org_id, project_id)`.                                     |
| `ingestWorkers`     | `max(1, floor(cores / 4))`       | One per queue shard.                                                                |
| `compactionWorkers` | `max(1, floor(cores / 4))`       | Stripe across columnar shards.                                                      |
| `queryWorkers`      | `max(1, floor(cores / 4))`       | Scatter-gather across columnar shards.                                              |
| `apiProcs`          | `max(2, floor(cores / 8))`       | Read-side HTTP API; same shape as relay.                                            |
| `wsFanoutProcs`     | (per topology)                   | WebSocket fan-out for live event streams.                                           |
| `alertCoordinator`  | `1`                              | Single owner of alert-rule scheduling.                                              |
| `alertEvaluators`   | `max(4, ceil(projects / 100))`   | Scales with project count, not cores.                                               |
| `cronLeader`        | `1`                              | Single owner of cron expected-check-in tracking.                                    |
| `uptimeProbers`     | `max(2, ceil(monitors / 500))`   | Scales with monitor count.                                                          |
| `seerWorkers`       | (per topology)                   | ML heuristics for anomaly detection.                                                |

`columnar_shards = cores` is the §12.2 spec resolution; see [`specs/SPEC-CORRECTIONS.md` §1](../../specs/SPEC-CORRECTIONS.md).

## Reference counts

| Cores | Relays | Cols | Queue | Meta | Ingest | Compact | Query | API | Total CPU-bound |
| ----: | -----: | ---: | ----: | ---: | -----: | ------: | ----: | --: | --------------: |
| 4     | 2      | 4    | 1     | 1    | 1      | 1       | 1     | 2   | ~24             |
| 8     | 2      | 8    | 2     | 2    | 2      | 2       | 2     | 2   | ~33             |
| 16    | 2      | 16   | 4     | 4    | 4      | 4       | 4     | 2   | ~51             |
| 32    | 4      | 32   | 8     | 8    | 8      | 8       | 8     | 4   | ~91             |
| 64    | 8      | 64   | 16    | 16   | 16     | 16      | 16    | 8   | ~171            |

To get exact numbers for your host:

```bash
bun -e 'const t=await import("./packages/topology/src/index.ts"); console.log(t.summarize(t.computeTopology({cores: 32, projects: 50, monitors: 200})))'
```

## What scales linearly with cores

- **Envelope ingest throughput** — relay processes accept connections via `SO_REUSEPORT`. Adding cores adds relay processes; kernel load-balances.
- **Columnar write throughput** — one MemTable per shard, no shared lock; writes hash to a shard and stay there.
- **Compaction throughput** — compactors stripe across shards; each shard's compaction is independent.
- **Query throughput** — scatter-gather across shards; per-shard predicate pushdown via zone-maps.

## What doesn't scale with cores

- **Metadata writes** — bounded by the SQLite shard count (`cores / 4`). SQLite WAL mode handles concurrent readers fine but writes serialize per file.
- **Alert evaluators** — sized by project count, not cores. Adding cores to a host with 5 projects gives you the same evaluator count.
- **Cron leader** — single process. The work is light (one schedule check per minute); the leader is for correctness, not throughput.
- **External I/O** — outbound webhooks, integration calls, and uptime probes hit the network. Add `uptimeProbers` for monitor count, not cores.

## How to pick a host

Some rules of thumb:

- **Single host pilot**: 8-core, 16 GiB RAM, 200 GiB NVMe. Handles a few thousand events/s comfortably with weeks of retention.
- **Mid-tier production**: 16-core, 32 GiB RAM, 1 TiB NVMe. Tens of thousands of events/min, dozens of projects.
- **High-throughput**: 32-core, 64 GiB RAM, 2 TiB NVMe per host. The 10k events/s sustained / ~25k peak ceiling.
- **Horizontal scale**: Warden is single-host as written today (no built-in cross-host queue/store sharding). To scale horizontally, partition projects across hosts at the relay (different DSN hosts per project group) — Warden's per-host model handles each partition independently.

## Tuning tips

1. **Watch event-loop lag.** If `sr_relay_event_loop_lag_seconds` p95 climbs past 50 ms, raise the relay count even if your formula says otherwise. PII regex is CPU-bound.
2. **Watch compaction lag.** `sr_columnar_compaction_lag_seconds` rising means sealed segments are piling up. Add a compactor or move to a faster disk.
3. **MemTable size knobs.** `maxRows=250k`, `maxByteSize=64 MiB`, `maxAgeMs=60s` (in `packages/columnar/src/memtable/`). Larger MemTables mean fewer, bigger segments — better for query, worse for tail latency on shard restart (longer WAL replay).
4. **Don't over-shard queue.** The queue is already fast; more shards add file-handle overhead without throughput gain unless you're bottlenecked on a single shard.
5. **CPU isolation.** If you co-locate Warden with other services, use `cpuset` or k8s requests/limits so background compaction doesn't starve your relay event loop.
6. **NUMA**: pin per-NUMA-node process groups if you're on a 64-core dual-socket box. The supervisor doesn't do this for you.

## Where to read next

- [Storage and data](./storage-and-data.md) — disk sizing follows from event volume × retention × compression ratio.
- [Observability](./observability.md) — what to monitor so you know when to scale.
