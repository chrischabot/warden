# Package reference

Every internal workspace package, what it does, and where to look. All packages are under `@sr/<name>` in `packages/<name>/`.

## Core infrastructure

### `@sr/topology` — [`packages/topology`](../../packages/topology)

The single source of truth for process sizing. Encodes the §12.2 spec formulas with a `max(1, ...)` floor. Exports `TopologyInputs`, `Topology`, `detectCores()`, `computeTopology()`, `summarize()`, `defaultTopology()`. See [Scaling and topology](../operations/scaling-and-topology.md).

### `@sr/columnar` — [`packages/columnar`](../../packages/columnar)

The columnar event store kernel. Encodings (`encodings/`), MemTable (`memtable/`), WAL (`wal/`), segment reader/writer (`segment/`), query planner + executor (`query/`), compaction (`compaction/`), hot-page cache (`cache/`). See [Columnar event store](./columnar-store.md).

### `@sr/queue-core` — [`packages/queue-core`](../../packages/queue-core)

Segmented append-only log with group-commit fsync and crash recovery. See [Queue](./queue.md).

### `@sr/sqlite-shard` — [`packages/sqlite-shard`](../../packages/sqlite-shard)

Metadata sharding via `ShardRouter` (Bun.hash wyhash). Exports `ShardRouter`, connection pool, migration runner.

### `@sr/proto` — [`packages/proto`](../../packages/proto)

Envelope protocol parsing. DSN parser, baggage, sentry-trace, trace-context, traceparent, envelope items.

### `@sr/grouping` — [`packages/grouping`](../../packages/grouping)

Fingerprinting and group-hash. See [Grouping](./grouping.md).

### `@sr/symbolicator` — [`packages/symbolicator`](../../packages/symbolicator)

JavaScript source-map resolver. `SourceMapResolver.resolve(line, column)` does the v3 VLQ delta accumulation and binary searches the line's segments.

### `@sr/pii` — [`packages/pii`](../../packages/pii)

PII scrubbing patterns + walker. See [PII scrubbing](./pii-scrubbing.md).

### `@sr/rate-limit` — [`packages/rate-limit`](../../packages/rate-limit)

LeakyBucket and rule matcher. See [Rate limiting](./rate-limiting.md).

### `@sr/outcomes` — [`packages/outcomes`](../../packages/outcomes)

Outcome categories and the `OutcomeRecorder` interface. See [API: outcomes](../api/outcomes.md).

### `@sr/sampling` — [`packages/sampling`](../../packages/sampling)

Deterministic rule-based dynamic sampler. See [Sampling](./sampling.md).

### `@sr/auth` — [`packages/auth`](../../packages/auth)

DSN and token authenticators, scope-check, error kinds. See [Auth](./auth.md).

### `@sr/hll-tdigest` — [`packages/hll-tdigest`](../../packages/hll-tdigest)

HyperLogLog (cardinality), t-digest (percentiles), Bloom filter (membership), Count-Min Sketch (frequency). All used by the columnar query layer for fast approximate aggregations.

### `@sr/metrics` — [`packages/metrics`](../../packages/metrics)

Prometheus client + `sr_*` namespace bootstrapping. Standard buckets (`LATENCY_BUCKETS`, `SIZE_BUCKETS`). Helpers `counter`, `gauge`, `histogram`, `summary`, `renderText`.

### `@sr/observability` — [`packages/observability`](../../packages/observability)

Health probes (`/internal/healthz`, `/readyz`, `/startupz`), heartbeat emitter, system metrics. See [Operations: observability](../operations/observability.md).

## Domain packages

Each owns its data model, store, and (where applicable) workers / detectors.

| Package                | What                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@sr/issues`           | Issue (group) store, ULID short IDs, regression detection.                                                                    |
| `@sr/releases`         | Release versions (semver), commit lists, deploy markers, regression and resolution accounting.                                |
| `@sr/performance`      | Transaction/span analytics, outlier detection, N+1 detection.                                                                  |
| `@sr/alerts`           | Issue alerts, metric alerts, severity ladder, notification dispatch.                                                          |
| `@sr/crons`            | Scheduled-job heartbeats and missed-check-in tracking.                                                                         |
| `@sr/uptime`           | HTTP/TCP probing.                                                                                                              |
| `@sr/replays`          | Session replay event storage.                                                                                                  |
| `@sr/profiling`        | CPU profile storage + flame-graph construction.                                                                                |
| `@sr/logs`             | Native log storage.                                                                                                            |
| `@sr/custom-metrics`   | User-defined counter / gauge / distribution metrics with HLL + t-digest aggregation.                                          |
| `@sr/integrations`     | Adapters for outbound notifications (Slack, GitHub, Jira, PagerDuty, OpsGenie) and dispatch logic.                              |
| `@sr/admin`            | Organisation/Team/Project/User/Token types and RBAC.                                                                           |
| `@sr/seer`             | ML heuristic anomaly-detection service (placeholder for the real ML; runs heuristics today).                                  |
| `@sr/otlp`             | OpenTelemetry trace + log JSON decoding, conversion to Warden's envelope item shape. See [API: OTLP](../api/otlp.md).         |

## Apps

| App        | What                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/relay`  | HTTP envelope ingest. Stateless. `reusePort: true`. Streams envelope bodies; per-item rate-limit, PII, sample, enqueue, outcome. |
| `apps/ingest` | Queue consumer. Reads queue, fingerprints, writes to columnar MemTable.                                  |
| `apps/web`    | React 19.2 + Tailwind v4.3 + React Router 7 + Vite 6 static bundle.                                       |

## SDKs

Outside the workspace dependency graph (so they can be vendored).

| Path                 | What                          |
| -------------------- | ----------------------------- |
| `sdks/javascript`    | JS/TS SDK (Node, Bun, browser, Workers). |
| `sdks/python`        | Sync Python SDK.              |
| `sdks/rust`          | Sync Rust SDK + panic hook.   |
| `sdks/go`            | Go SDK with `Hub.Clone()` for goroutines. |
| `sdks/swift`         | Sendable Swift SDK for iOS / macOS / Linux. |

## Tests + tooling

- `e2e/` — end-to-end suite + 20 k load-burst harness.
- `apps/web/test-e2e/` — Playwright UI journeys.
- `infra/ci/typescript-migration.md` — tsgo migration notes.

## Source-of-truth and corrections

- [`specs/SPEC.md`](../../specs/SPEC.md) — the original specification.
- [`specs/SPEC-CORRECTIONS.md`](../../specs/SPEC-CORRECTIONS.md) — deltas the implementation took against the spec, each with reasoning.

## Where to read next

- [Contributing](../contributing.md) for the dev workflow.
- [Columnar event store](./columnar-store.md), [Queue](./queue.md), [Grouping](./grouping.md), [Sampling](./sampling.md), [PII](./pii-scrubbing.md), [Rate limiting](./rate-limiting.md), [Auth](./auth.md) for deeper coverage of each subsystem.
