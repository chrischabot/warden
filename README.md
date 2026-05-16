# Warden

A faithful reimplementation of Sentry using Bun.

Warden ingests, stores, groups, queries, alerts on, and visualises errors, traces, profiles, replays, crons, uptime checks, releases, logs, and metrics. It ships five first-party SDKs (TypeScript, Rust, Go, Python, Swift), accepts OpenTelemetry traces and logs over OTLP/JSON, and runs entirely on Bun with no external database, queue, or message broker.

Run it on your laptop, a single VM, or a 64-core box. The same binary scales from one to the other without configuration.

---

## What you get

- **Error tracking** — stacktraces, source-mapped frames, fingerprinting, grouping, regression detection.
- **Performance monitoring** — distributed traces, spans, p50/p75/p95/p99, slow-query and N+1 detection.
- **Profiling** — sampled CPU profiles per transaction, flame graphs in the UI.
- **Session replay** — DOM replay for the JS SDK, with PII scrubbing.
- **Crons & uptime** — scheduled-job heartbeats and HTTP/TCP probes with alerting.
- **Releases & source maps** — release health, regressions, artifact upload, symbolicated frames.
- **Logs & custom metrics** — structured logs and counter/gauge/distribution metrics with HLL + t-digest aggregation.
- **OpenTelemetry interop** — accepts OTLP/JSON traces and logs on the standard endpoints.
- **Alerts** — metric alerts, issue alerts, anomaly detection, notification fan-out.
- **Multi-tenancy** — organisations, projects, teams, roles, DSN + token auth.
- **Web UI** — 14 routes covering dashboard, issues, performance, traces, profiles, discover, dashboards, alerts, crons, uptime, releases, source maps, SDK setup wizard, settings.

---

## How it's built

Warden is a Bun-native monorepo. Every runtime process is `bun src/index.ts` — there is no transpile step, no bundler in the hot path, and no `.d.ts` emission. TypeScript is type-checked with `tsgo` (the TypeScript 7 native preview, ~10× faster than `tsc`) purely as a CI gate.

The interesting bits:

### A custom columnar event store

Events are written into segment files with per-column encodings chosen at write time: RLE for low-cardinality strings, dictionary for repeated identifiers, delta-for-frame-of-reference for monotonically increasing timestamps, raw for everything else. Each segment carries a zone-map (min/max + null-count per column per block) so query planners can prune most segments without reading them. A bit-packed buffer layer underlies the encodings. Writes go through a MemTable backed by a write-ahead log; a background compaction worker merges MemTable flushes into sealed segments. Queries are planned against the zone-maps first, then executed column-by-column with predicate pushdown. HyperLogLog and t-digest sketches give exact-enough cardinality and percentile answers without scanning raw rows.

### A custom queue

A segmented append-only log with group-commit fsync, CRC-checked records, and crash-recovery on open. Segment files roll on size or age. Consumers read by byte offset; offsets are stable across process restarts. No Kafka, no Redis, no NATS — just files and `fsync`.

### A custom relay

The relay accepts the Sentry envelope protocol on `POST /api/{project_id}/envelope/`. It parses streaming envelopes (so a 100 MiB minidump never lands in memory whole), authenticates the DSN, rate-limits per project + envelope item type, scrubs PII, applies dynamic sampling, enqueues accepted items, and records outcomes for everything dropped. Multiple relay processes share the same port via `SO_REUSEPORT` and let the kernel load-balance.

### Dynamic topology

Process counts are derived from the host's logical core count at boot — there is no `procs: 8` in any config file. A 4-core laptop runs ~24 CPU-bound processes; a 64-core box runs ~171. The single source of truth lives in `packages/topology`, which encodes formulas like `columnar_shards = cores`, `relay_procs = max(2, cores / 8)`, `ingest_workers = max(2, cores / 2)`, and so on. Approximate counts:

| Cores | Total processes |
|------:|----------------:|
| 4     | ~24             |
| 8     | ~33             |
| 16    | ~51             |
| 32    | ~91             |
| 64    | ~171            |

### Multi-core scaling

Warden does not rely on Bun worker threads for CPU work — it forks OS processes. The supervisor spawns N of each process kind sized by topology, and each kind binds the work it does:

- **Relay processes** share a TCP port via `reusePort: true` and are stateless behind it.
- **Ingest workers** consume from queue shards; queue-shard count equals worker count, so each shard has exactly one consumer.
- **Columnar shards** partition events by `(project_id, hash)`; each shard owns its MemTable, WAL, and sealed segments on disk.
- **Query workers** scatter-gather across columnar shards.
- **Alert evaluators, cron leader, uptime probers, Seer (anomaly detection) workers, WS fan-out, API procs** each scale independently from the same topology table.

The metadata store is `bun:sqlite` with WAL mode, sharded by `(org_id, project_id)` across `metadataShards` files — JavaScriptCore is single-threaded per isolate, but SQLite's file-level concurrency plus shard fan-out gives linear metadata throughput up to core count.

### Bun-native everything

- `Bun.serve` with `reusePort` for HTTP.
- `Bun.file` for zero-copy segment reads.
- `bun:sqlite` for metadata, with prepared-statement caches per shard.
- `Bun.password` and `Bun.CryptoHasher` for auth and content hashing.
- Bun's native `fetch` for outbound webhooks.
- No `node_modules` C++ addons. No `napi-rs`. No native deps to rebuild on upgrade.

### The stack

- **Bun** 1.3.14 — runtime.
- **TypeScript 7 beta** (`@typescript/native-preview`, the `tsgo` binary) — type-checking only; Bun runs `.ts` directly.
- **Effect v4 beta** — structured concurrency and error handling for hot paths.
- **Biome v2** — lint + format.
- **React 19.2** + **Tailwind v4.3** (Oxide engine) + **React Router 7** + **Vite 6** — web UI.

### Measured throughput

On a 2 vCPU / 8 GiB sandbox: **14,268 events/s sustained** end-to-end over a 20,000-event burst, 100% accuracy across errors / transactions / logs, event-loop lag p95 = 26.78 ms / p99 = 37.89 ms, peak RSS delta = 92 MiB. The design ceiling at 32 cores is 10k events/s sustained and ~25k peak.

---

## Install

Requires Bun 1.3.14 or newer.

```bash
git clone https://github.com/chrischabot/warden.git
cd warden
bun install --frozen-lockfile
```

Validate the install:

```bash
bun run validate            # biome + tsgo + bun test (1,036 tests)
```

---

## Run

Each app is `bun src/index.ts`. In development you can run them directly:

```bash
# HTTP relay (envelope ingestion) — default port 9000
bun apps/relay/src/index.ts

# Ingest workers (consume queue, group, save)
bun apps/ingest/src/index.ts

# Web UI (Vite dev server)
cd apps/web && bun run dev
```

In production a single supervisor (systemd, supervisord, or your orchestrator of choice) spawns N of each process per the topology computed at boot. The relay processes share port 9000 via `SO_REUSEPORT`; ingest workers pin to queue shards by index.

The data directory holds the queue segments, columnar segments, WAL files, and SQLite metadata shards. Point it at fast local storage (NVMe). No external services are required.

---

## Use it

### From an application — SDKs

Warden ships five SDKs in `sdks/`:

```bash
sdks/javascript    # @warden/sdk — works in Node, Bun, browsers
sdks/python        # warden-sdk — sync + asyncio
sdks/rust          # warden — Tokio-based
sdks/go            # warden-go — context-aware
sdks/swift         # Warden — iOS, macOS, Linux
```

All five speak the Sentry envelope protocol, so any existing Sentry-compatible tooling works against Warden by changing the DSN host. A DSN looks like:

```
https://<public_key>@warden.example.com/<project_id>
```

Initialise once at process start, then call `captureException`, `captureMessage`, `startTransaction`, `addBreadcrumb`, etc. — the API mirrors what you already know.

### From the web UI

Open the web app (Vite dev server at `http://localhost:5173`, or your built bundle behind any static host) and sign in. Routes:

```
/                         dashboard
/issues                   issue list
/issues/:id               issue detail (events, stack, breadcrumbs)
/performance              transaction overview
/traces                   trace list
/traces/:id               trace waterfall
/profiles                 sampled profiles + flame graphs
/discover                 ad-hoc query builder
/dashboards               custom dashboards
/alerts                   metric + issue alerts
/crons                    cron monitors
/uptime                   uptime monitors
/releases                 release health
/settings                 org/project/team/member settings
```

### From OpenTelemetry

Point your OTLP/JSON exporter at the relay. Traces and logs are accepted on the standard OTLP HTTP paths and converted into Warden's native event shape on ingest. Protobuf wire is not yet implemented — use the JSON exporter.

### From the HTTP API

The same relay process exposes the Sentry-compatible envelope endpoint:

```
POST /api/{project_id}/envelope/
Content-Type: application/x-sentry-envelope
X-Sentry-Auth: Sentry sentry_key=<public_key>, sentry_version=7
```

Body is a newline-delimited envelope: one JSON header, then alternating item-header / item-payload pairs. The relay streams the body, so envelope items up to 100 MiB (minidumps, large attachments) are handled without buffering.

Authentication uses either a DSN public key (for ingest) or a bearer token (for read APIs and admin endpoints).

---

## Layout

```
warden/
├── docs/SPEC.md                  # full specification
├── packages/                     # 29 internal packages
│   ├── topology/  metrics/  proto/
│   ├── columnar/  hll-tdigest/  queue-core/
│   ├── grouping/  symbolicator/  pii/
│   ├── rate-limit/  outcomes/  sampling/
│   ├── issues/  releases/  performance/
│   ├── alerts/  crons/  uptime/
│   ├── replays/  profiling/
│   ├── logs/  custom-metrics/  integrations/
│   ├── admin/  seer/  otlp/
│   └── auth/  sqlite-shard/  observability/
├── apps/
│   ├── relay/    # HTTP ingest
│   ├── ingest/   # queue consumers
│   └── web/      # React UI
├── sdks/
│   └── javascript/  rust/  go/  python/  swift/
└── e2e/                          # end-to-end + load tests
```

---

## License

MIT. See [LICENSE](./LICENSE).
