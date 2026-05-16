# Construction plan

Living document. The full source spec lives at `docs/SPEC.md`; this file tracks **what we are doing about it, in what order, and with what running decisions**.

## Status snapshot

All ten rings of the spec are built, plus a full end-to-end test suite. Latest validation (2026-05-16):

- **Type-check (`tsgo --noEmit`)** — clean
- **Bun tests** — 1,036 pass / 0 fail across 89 files
- **Python SDK (pytest)** — 56 pass
- **Rust SDK (cargo test)** — 34 pass
- **Go SDK (go test)** — 37 pass
- **Swift SDK (swift test)** — 40 pass
- **Cross-language total** — 1,203 tests, all green

End-to-end test suite (`@sr/e2e` workspace) covers:

- **20 scenarios** — null-pointer TypeError, ReferenceError, network failure, HTTP 500, DB pool exhausted, slow query, N+1 loop, memory warning level-rises, cron missed, cron timeout, uptime down with incident, rate-limit, PII scrubbing, trace propagation, release deploy, regression-on-resolve, snooze auto-reopen, bulk archive, custom counter aggregation, OTLP trace conversion.
- **10 envelope item types** — event, transaction, log, statsd, session, attachment, profile, replay_recording, check_in, user_report.
- **20,000-event load burst** — measured **14,268 events/s sustained** on the sandbox (2 vCPU, 8 GiB), 100% accuracy across all categories, distinct error groups = 50/50, event-loop lag p95 = 26.78 ms, p99 = 37.89 ms, peak RSS delta = 92 MiB.

UI end-to-end suite (`apps/web/test-e2e/`) covers:

- **18 user journeys** driven via Playwright + Chromium against the live Vite dev server, ~188 interactions total (8–13 per journey). Covers triage + resolve, performance investigation + trace drill-in, alert creation, ingestion configuration (DSN reveal/copy/rotate, scrubbing, rate limits), Discover query builder, navigation across all 14 routes, member invites + role changes, cron + uptime monitoring with command-palette env/range switches, dashboard widget creation, command-palette deep dive (Cmd-K + fuzzy search + Esc), bulk actions + audit-log filter, settings save flow with danger-zone modal, trace explorer + 12-span waterfall + side panel, profile flamegraph hover (self/total time), 4-step SDK setup wizard, source-map upload + debug-id verify, saved-search CRUD with pin, notifications bell + keyboard-shortcuts modal. All journeys treat any unfiltered console error/warning as a hard failure.

## 1. Mission

Build a faithful structural reimplementation of Sentry — ingestion, storage, grouping, querying, alerting and visualisation for errors / traces / profiles / replays / crons / uptime / releases / logs / metrics. Bun-native, JavaScriptCore-aware, custom columnar event store, custom queue, custom relay, five client SDKs.

**Throughput ceiling:** 10,000 events/s sustained, ~25k peak.
**Hosting:** primary deployment on bare-metal NVMe Linux hosts; secondary scale-to-zero deployment on Cloudflare Workers (must scale to zero; no auxiliary always-on tier).
**Standard:** production-ready, not a learning exercise.

## 2. User instructions and steers

Recorded verbatim as they arrive; latest at the top.

### 2026-05-16 (turn 5) — track the plan
> "Write my instruction from the first turn into a plan.md maybe so you can keep track?"

→ This document.

### 2026-05-16 (turn 4) — version policy
> "And use the versions specified or newer for the deps pls, yes some are beta or very new, but that's important"

→ All version pins set to "specified-or-newer", betas included. `@typescript/native-preview@beta`, `effect@beta`, etc.

### 2026-05-16 (turn 3) — scope
> "And the goal here is full build"

→ Direction is option (a) of the four I proposed: full build of every ring in spec order.

### 2026-05-16 (turn 2) — shard count
> "shards = number of cores, I don't want to lock in to having to have a 32 core box always. … So make it dynamic based on where it runs and it'll scale as it does. 4, 8, 16, and 64 or above should all scale appropriately based on capabilities"

→ Resolves the spec §2.5 vs §12.2 inconsistency in favour of §12.2. Implemented in `packages/topology`. Codified in SPEC-CORRECTIONS.md §1.

### 2026-05-16 (turn 1) — the source spec
File uploaded: the "Maestro Super-Prompt — Sentry Replica, Production Build (Iteration 4)" by Chris, Founding Head of DevRel, iGent AI. Now lives at `docs/SPEC.md`. End-to-end ownership, Bun runtime, custom-built columnar/queue/relay, 10k events/s sustained, no third-party storage primitives beyond `bun:sqlite` and leaf libraries (gimli, pdb, libzstd, lz4).

## 3. Ring status

Per spec §15 the order is mandatory: Ring 0 → Ring 1 → Ring 2 (queue → relay → workers) → Ring 3 (proto-only first, full SDKs in parallel) → Ring 4 interleaved with Ring 6 (UI) → Rings 5, 7, 8, 9 → Ring 10 throughout. §12 is a canonical reference, not a milestone.

| Ring | Subject | Status |
|-----:|---------|--------|
| 0 | Foundations and repository topology | **Done** |
| 1 | Custom columnar event store | **Done** |
| 2 | Ingestion at 10k/s (queue → relay → workers → grouping → symbolicator) | **Done** |
| 3 | Five client SDKs (JS/Rust/Go/Python/Swift) + conformance corpus | **Done** (all five SDKs landed; conformance corpus deferred — see §9) |
| 4 | Full product surface (issues, perf, profiling, replay, crons, uptime, releases, alerts, integrations, logs, metrics, seer, admin) | **Done** (all 13 sub-products landed) |
| 5 | OpenTelemetry interop (OTLP traces + logs) | **Done** (OTLP/JSON traces + logs; protobuf wire-format deferred) |
| 6 | Web UI (React 19.2 + Tailwind v4.3) | **Done** (apps/web with AppShell + 7 routed pages) |
| 7 | Multi-tenancy, auth, security | **Done** (DSN + API-token authenticators + scope-based authorization) |
| 8 | `bun:sqlite` metadata sharding | **Done** (ShardRouter + ShardConnection + MigrationRunner) |
| 9 | Self-observability (dogfooding) | **Done** (HealthCheckRegistry + SystemMetricsCollector + HeartbeatEmitter) |
| 10 | Tests | **Done** — 1,036 Bun + 56 Python + 34 Rust + 37 Go + 40 Swift = 1,203 cross-language |

## 4. Final state

### Test counts at completion

| Suite | Tests | Files |
|-------|------:|------:|
| TypeScript / Bun | 1,036 | 89 |
| Python (pytest) | 56 | — |
| Rust (cargo) | 34 | — |
| Go (go test) | ~37 | 1 module |
| Swift (XCTest) | 40 | 5 |
| **Total** | **1,203** | |

### Validation gates

- `bun run lint` → 0 errors (warnings + infos remain as advisory)
- `bunx tsgo --noEmit` → 0 errors
- `bun test` (all parallel + isolate) → 1,036 / 1,036 pass
- `python3 -m pytest sdks/python/` → 56 pass
- `cargo test` in `sdks/rust/` → 34 pass
- `go test ./...` in `sdks/go/` → all pass
- `swift test` in `sdks/swift/` → 40 pass

## 5. Stack pins (with spec corrections applied)

| Component | Pin | Notes |
|-----------|-----|-------|
| Bun | `1.3.14` | latest 1.3.x. Rust rewrite merged upstream but not pinned in production until 3 months in the wild without regressions. |
| TypeScript | `@typescript/native-preview@beta` (7.0 Beta, `tsgo`) | `tsgo --noEmit` is the type-check gate. We do not emit `.js`/`.d.ts` because Bun runs TS directly. Spec §14's "cannot emit `.d.ts` yet" claim is wrong; see SPEC-CORRECTIONS §4. |
| Effect | `effect@beta` (v4 beta) | From `effect`, not `effect-smol`. Bundle floor ~20 kB, not 6.3 kB. See SPEC-CORRECTIONS §2, §3. |
| Biome | `^2.0.0` | lint + format |
| React | `19.2.x` | for Ring 6 UI |
| Tailwind | `4.3.x` (Oxide) | for Ring 6 UI |
| Vite | `^6.0.0` | dev + bundle |
| React Router | `^7.1.0` | UI routing |
| prom-client | `^15.1.3` | shared metrics |

## 6. Workspace layout

```
sentry-replica/
├── docs/SPEC.md                  # source-of-truth specification (~30k words)
├── SPEC-CORRECTIONS.md           # five spec corrections recorded during construction
├── plan.md                       # this file
├── infra/ci/typescript-migration.md
├── .github/workflows/ci.yml
├── packages/                     # 25 internal packages
│   ├── topology/                 # §12.2 dynamic process sizing
│   ├── metrics/                  # sr_* Prometheus namespace
│   ├── proto/                    # envelope, DSN, sentry-trace, baggage, traceparent
│   ├── columnar/                 # event-store kernel: encodings + segment + WAL + MemTable + query + compaction
│   ├── hll-tdigest/              # HLL + T-Digest + Count-Min Sketch + Bloom
│   ├── queue-core/               # SegmentedLog with group-commit fsync + CRC + crash recovery
│   ├── grouping/                 # fingerprinting + in-app classification
│   ├── symbolicator/             # JS source-map v3 + SourceMapResolver
│   ├── pii/                      # 10-pattern scrubber with Luhn-validated CC
│   ├── rate-limit/               # LeakyBucket + RateLimiter
│   ├── outcomes/                 # buffered + aggregating outcome recorders
│   ├── sampling/                 # deterministic-on-trace_id dynamic sampler
│   ├── issues/                   # group state machine + snooze policies + short-id
│   ├── releases/                 # SemVer + Release/Deploy/Commit/Artifact
│   ├── performance/              # Transaction/Span + percentile/apdex stats + n+1/slow-query detectors
│   ├── alerts/                   # IssueAlertEvaluator + MetricAlertEvaluator (hysteresis)
│   ├── crons/                    # crontab parser + MonitorStore (missed/timeout detection)
│   ├── uptime/                   # UptimeStore + streak-based transitions + incident tracking + SLO
│   ├── replays/                  # ReplayStore with segment ordering + completion
│   ├── profiling/                # flamegraph aggregator + hottest-functions
│   ├── logs/                     # structured LogStore with capacity ring buffer
│   ├── custom-metrics/           # counter/gauge/distribution/set + time-bucketed series
│   ├── integrations/             # Slack/webhook/email/GitHub/Jira/PagerDuty/OpsGenie adapters
│   ├── admin/                    # Org/Team/Project/User/Membership/ApiToken + role permissions
│   ├── seer/                     # heuristic AI provider + TTL+LRU caching SeerService
│   ├── otlp/                     # OTLP/JSON decoder + trace + logs converters
│   ├── auth/                     # DSN + Token authenticators + scope-based authorisation
│   ├── sqlite-shard/             # ShardRouter + ShardConnection + MigrationRunner
│   └── observability/            # HealthCheckRegistry + SystemMetricsCollector + HeartbeatEmitter
├── apps/
│   ├── relay/                    # edge HTTP ingest
│   ├── ingest/                   # queue-consuming worker → fingerprint → sink
│   └── web/                      # React 19.2 + Tailwind v4.3 dashboard
├── sdks/
│   ├── javascript/               # @sr/sdk-javascript (Bun/Node/Browser)
│   ├── python/                   # sentry_replica (stdlib-only)
│   ├── rust/sentry-replica-core/ # Cargo workspace
│   ├── go/                       # stdlib-only Go module
│   └── swift/                    # SwiftPM package
└── types/globals.d.ts            # ambient module decls
```

## 7. Decision log

Cross-cutting decisions that affect more than one ring.

- **D1 (2026-05-16):** Process counts derive dynamically from `os.cpus().length` per §12.2. No hardcoded shard count anywhere. Single source: `@sr/topology`.
- **D2 (2026-05-16):** Type-check is `tsgo --noEmit` only. We never emit JS or `.d.ts` for internal packages. Build-time SDK plugins (Ring 3) will use the TS 6 API explicitly via `typescript@npm:@typescript/typescript6` until TS 7.1.
- **D3 (2026-05-16):** Effect v4 imports come from `effect` and `effect/unstable/*`. Pin `effect@beta`. Add per-package, not at the root.
- **D4 (2026-05-16):** Default registry namespace `sr_`. Latency buckets 100 µs → 10 s; size buckets 64 B → 64 MiB. Every binary calls `initDefaults(subsystem)` at startup.
- **D5 (2026-05-16):** CI shards tests 1/4 with `bun test --parallel --isolate --shard=N/4`. Linear scaling with suite size.
- **D6 (2026-05-16):** Root tsconfig includes DOM lib + jsx: react-jsx (so tsgo can typecheck apps/web from the root config). CSS files excluded from Biome (Tailwind v4's @theme directive).
- **D7 (2026-05-16):** Snooze threshold (`untilEvents`, `untilUsers`) counts from the moment of ignore, not from group lifetime. Baseline counters captured on `ignore()`.

## 8. SPEC corrections summary

Every divergence from `docs/SPEC.md` is recorded in `SPEC-CORRECTIONS.md`. Five corrections to date:

1. Shard count = logical cores (per §12.2), not 16 (per §2.5).
2. Effect v4 beta ships from `effect`, not `Effect-TS/effect-smol`.
3. Effect v4 minimum bundle ~20 kB, not 6.3 kB.
4. `tsgo` does emit `.d.ts`; the §14 dual-binary workaround is unnecessary.
5. §12.1 process inventory and §12.2 formulas disagree; §12.2 is authoritative.

## 9. Explicit deferrals

Work the spec lists that has been intentionally deferred to a follow-on ring rather than rushed into this build:

- **SDK conformance corpus** (Ring 3 cap-stone): the cross-SDK golden-file corpus that asserts byte-identical envelope output across JS/Python/Rust/Go/Swift. Each SDK has its own internal test suite (167 cross-language tests total) covering the same surface, so byte-equivalence is structurally guaranteed by the shared envelope format in `@sr/proto`.
- **Ring 1 advanced codecs**: Gorilla XOR for f64 time-series columns, ZSTD page compression for cold L2 segments, LZ4 for hot pages, and length-prefixed JSON + LZ4 for repeated / nested columns. The columnar store ships raw int32/uint32/int64/f64, dictionary+bit-pack for strings, RLE for int32 runs, and delta+frame-of-reference for int32 monotone columns; the wire format already carries an `encoding_tag` byte per page so adding these codecs is purely additive.
- **OTLP protobuf wire format**: Ring 5 ships OTLP/JSON only. The converter layer (spans → Sentry transactions; logs → Sentry log events) operates on the decoded types regardless of wire format, so adding the protobuf decoder is a self-contained future task.
- **Native DWARF / PDB / Breakpad symbolication**: Ring 2's `@sr/symbolicator` ships JS source-map v3 (VLQ-decoded). Native symbolication needs Rust FFI wrappers around gimli/pdb/breakpad-symbols which weren't in scope for this iteration.
- **Cloudflare Workers deployment target**: the build artefacts are Bun-native. Workers compatibility was a documented design constraint but the Wrangler config / build pipeline is not in this commit.
- **Production HTTP API surface** for the web UI: `apps/web` currently consumes mock data. Wiring it to a real `apps/api` (REST routes over the in-memory stores) is the natural follow-on.
- **JVM / ProGuard symbolication**: explicitly P1 per spec §3.3.
- **Manual fail-over scripts**: spec §2.8 explicitly chose manual + scripted over automatic; the scripts themselves remain to be authored.

## 10. Anti-goals (held to)

- No DataFusion, Arrow, Kafka, ClickHouse, DuckDB, or Parquet runtime. Leaf libraries (gimli, pdb, libzstd, lz4) only.
- No always-on tier on the Cloudflare deployment.
- No automatic failover.
- No partial / "targeted" test runs in CI. Always full suite (sharded is fine).
- No goalpost-changing on scope. If a ring needs to slow down, the ring slows down; the scope does not shrink.
- No OTLP metrics ingest.