# Platform overview

Warden is an observability platform that collects, stores, groups, queries, alerts on, and visualises operational data from production systems. It is built to be drop-in compatible with the Sentry envelope protocol — the same SDKs and the same on-the-wire shape — so existing Sentry-compatible tooling works against a Warden host with a DSN change.

It runs entirely on Bun, with no external database, no external message broker, and no external object store in the hot path. SQLite is used (via `bun:sqlite`) for sharded metadata. All other state lives in segment files Warden writes itself.

## What Warden captures

**Errors.** Exceptions and structured messages with full stacktraces, source-mapped frames (JavaScript), grouping into issues, regression detection across releases.

**Transactions and traces.** Per-request transaction objects and distributed trace trees. p50/p75/p95/p99 latency per operation, slow-query and N+1 detection.

**Profiles.** Sampled CPU profiles attached to transactions, rendered as flame graphs.

**Replays.** DOM session replay for the JavaScript SDK, with PII scrubbing applied before storage.

**Crons.** Heartbeats from scheduled jobs (cron entries, k8s CronJobs, GitHub Actions schedules, etc.). Alerts on missed or failed runs.

**Uptime.** HTTP and TCP probes from the platform to your services with regional probe support.

**Releases.** Release health, regression detection per release, deploy markers, artifact upload for source maps and debug files.

**Logs.** Structured logs with timestamp, severity, body, attributes, and trace correlation.

**Custom metrics.** Counter, gauge, and distribution metrics with HyperLogLog-backed unique counts and t-digest-backed percentiles.

**OpenTelemetry interop.** OTLP/JSON traces and logs accepted on the standard paths and converted to Warden's native shape on ingest.

## How it's different

**One binary, every scale.** A 4-core laptop, a 16-core staging box, and a 64-core production box all run the same code. The process count is derived from the host's core count at boot, so there is no "small mode" vs "large mode" configuration. See [Scaling and topology](./operations/scaling-and-topology.md).

**No external dependencies in the hot path.** No Postgres, no Redis, no Kafka, no S3 to host the platform. Warden's queue is an append-only segmented log it writes directly to disk; its event store is a columnar engine it implements itself; its metadata is `bun:sqlite` files sharded by `(org, project)`. The only external service you might add is a reverse proxy for TLS termination.

**Bun-native.** `Bun.serve` with `reusePort` for HTTP, `Bun.file` for zero-copy segment reads, `bun:sqlite` with WAL mode for metadata, `Bun.password` and `Bun.CryptoHasher` for auth and content hashing, Bun's native `fetch` for outbound webhooks. No `node_modules` with C++ addons to rebuild on every upgrade.

**Five SDKs, one wire format.** TypeScript, Rust, Go, Python, and Swift all speak the Sentry envelope protocol over HTTP. The same `captureException` / `captureMessage` / `withScope` / `setUser` surface is exposed in each.

## What's live today

| Surface                                | Status                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| Envelope ingest endpoint               | Live (`POST /api/{project_id}/envelope/`)                             |
| Rate limit, PII, dynamic sampling      | Live (in the relay)                                                    |
| Columnar store                         | Live (writes, sealed segments, zone-maps, query path, compaction)     |
| Queue (segmented log + group commit)   | Live (crash-recovery on open, fsync batching)                         |
| Issue fingerprinting + grouping        | Live                                                                  |
| All 5 SDKs                             | Live (capture, scope, hub, transport, envelope codec, DSN parse)      |
| Web UI (14 routes)                     | Renders against mock data; read API integration in progress          |
| OTLP/JSON traces + logs                | Converters exist; HTTP routes not yet wired into the relay            |
| Read-side HTTP API for the dashboard   | In progress                                                            |
| Auth tokens for API consumers          | Type contracts in place; HTTP wiring in progress                       |
| Symbolication                          | JavaScript source maps (debug-id support)                             |
| Self-observability                     | Live (`sr_*` Prometheus namespace, health probes)                     |

Each doc that covers an in-progress surface calls it out explicitly.

## Where to read next

- [Concepts](./concepts.md) — the vocabulary the docs use: DSN, envelope, event, transaction, scope, hub, issue, group, fingerprint, release.
- [Architecture](./architecture.md) — the process model, data flow, and how the platform scales.
- [Reporting guide](./reporting-guide.md) — how to instrument an application well.
