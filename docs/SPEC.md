# Maestro Super-Prompt — Sentry Replica, Production Build (Iteration 4)

**Author:** Chris, Founding Head of DevRel, iGent AI · London
**Target agent:** Maestro (iGent AI autonomous coding agent)
**Date issued:** May 16, 2026
**Status:** Production specification. Not a sketch, not a prototype, not a “v1.”

-----

## 0. Mission Statement

You are going to build a Sentry replica from scratch. Not a wrapper, not a hosted-Sentry adapter, not a thin façade over OpenTelemetry. A faithful structural reimplementation that ingests, stores, groups, queries, alerts and visualises errors, traces, profiles, replays, crons, uptime, releases, logs and metrics for five internal services that constitute iGent’s coding-and-research agent platform. The replica is mission-critical from day one. It is not a learning exercise; it is the only thing standing between an engineer and a midnight pager.

Three non-negotiable axes of constraint frame everything that follows.

**Bun is the runtime.** Bun 1.3.14 — the last release before the Rust rewrite stabilises — is our pinned production runtime. The 5.5×-faster gzip via zlib-ng that shipped in 1.3.13 is load-bearing for our envelope path; `Bun.Image`, HTTP/3 server, the isolated linker, and `bun test --parallel --isolate --shard` are all in our toolbox. We do not use Node compatibility shims unless we must. We write Bun-native, JavaScriptCore-aware code.

**Ten thousand events per second sustained.** Not “10k bursts.” Not “10k once we scale out.” Ten thousand events per second sustained, with peak ceilings near 25k for brief minutes during incident storms. Every subsystem is dimensioned for that number — neither more, which would be wasted effort, nor less, which would be malpractice.

**Custom-built, not imported.** No external project handles parts of our system. The columnar event store is ours, written in TypeScript on Bun, using WebAssembly SIMD where vectors earn their keep. The ingestion queue is ours. The symbolicator orchestration is ours. The relay is ours. We do not graft in DataFusion, Arrow, Kafka, ClickHouse, DuckDB, or a Parquet runtime — those are architectural pieces, and architectural pieces are ours. We borrow ideas from C-Store, X100, ORC, Pinot, ClickHouse MergeTree, Druid and QuestDB; we borrow no binaries. Leaf libraries that handle bounded technical concerns — `gimli` for DWARF, `pdb` for PDB, `libzstd` and `lz4_flex` for compression — are fine regardless of licence, because they are libraries, not systems. The only third-party storage primitive we ship is `bun:sqlite` for relational metadata, sharded by `project_id`.

**Stack pins (verified May 2026):**

- **Bun 1.3.14** — pinned via `packageManager` and `engines`.
- **TypeScript 7.0 Beta** via `@typescript/native-preview` and the `tsgo` binary — the Go-based native port. Approximately 10× faster type-checking; we accept the feature gaps (declaration emit, `--build`) and use `tsc` only where `tsgo` cannot yet.
- **Effect v4 beta** from `Effect-TS/effect-smol`. Unified versioning, rewritten fiber runtime, ~6.3 KB minimum bundle, `effect/unstable/*` import paths for AI/HTTP/SQL/RPC/cluster/schema. Be deliberate about the keep-alive `setInterval` quirk and the enumerable-prototype Headers leak — both real, both encountered in production.
- **React 19.2.x + React Compiler.** `<Activity>` for state-preserving panel switches, `useEffectEvent`, Performance Tracks, batched Suspense reveals.
- **Tailwind CSS v4.3** with the Oxide engine, scrollbar utilities, `oklch()` palette, CSS-first `@theme`.
- **Cloudflare** is secondary. Use it for research agents, public PoCs, and the OSS demo. The Cloudflare target is bound by one design rule: **it must scale to zero.** No auxiliary always-on tier, no Bun service to call into, no pinned Durable Object for symbolication, no warmer cron, no compute that exists when no one is using the system. Scale-to-zero is the platform’s contract with its users, and the moment we add a hosted sidecar we have exported operational burden onto whoever deploys our OSS build. We honour it or we abandon the deployment target. The production replica running iGent’s five internal services lives on bare-metal NVMe Linux hosts we control.

**Voice and stance.** Hand-waving is a fireable offence. If you do not know a number, run a probe and measure. If you cannot verify, say so. Course-correct loudly when the user’s direction is wrong. Match the register: allusive, rhythmic, technical, never grade-school. Challenge before you confirm. Production readiness is now.

-----

## 1. Ring 0 — Foundations and Repository Topology

Before any feature work, scaffold the monorepo. Bun workspaces; one shared catalog; tsgo as the type-check driver in CI.

```
sentry-replica/
├── apps/
│   ├── relay/            # edge ingestion (Bun.serve, envelope parse)
│   ├── queue/            # custom segmented-log queue
│   ├── ingest/           # processing workers (parse→group→symbolicate→save)
│   ├── store/            # columnar event store daemon
│   ├── api/              # GraphQL+REST query layer
│   ├── web/              # React 19.2 UI
│   └── seer/             # AI triage worker (LLM-mediated)
├── packages/
│   ├── proto/            # envelope, DSN, sentry-trace, baggage codecs
│   ├── columnar/         # the event store kernel
│   ├── queue-core/       # log/segment/offset primitives
│   ├── grouping/         # fingerprinting engine
│   ├── symbolicator/     # native + JS + JVM symbolication
│   ├── hll-tdigest/      # approximate data structures
│   ├── sdk-conformance/  # cross-SDK test corpus
│   └── ui-kit/           # shadcn/ui + Tailwind v4.3 components
├── sdks/
│   ├── javascript/  rust/  go/  python/  swift/
└── infra/
    ├── ansible/  systemd/  prom-rules/  bench/  loadgen/
```

**Todo (Ring 0):**

1. `bun init` workspace, pin `bun@1.3.14` via `packageManager` and `engines`.
1. Add `@typescript/native-preview` as devDep; CI runs `bunx tsgo --noEmit` on every push.
1. Adopt Effect v4 beta: import from `effect`, `effect/unstable/http`, `effect/unstable/schema`, `effect/unstable/sql`, `effect/unstable/rpc`. Stub `setInterval` no-op shim only inside Workers PoC packages, never in production runtimes.
1. Establish `biome` for formatting; `oxlint` for the fast pre-commit; `bun test --parallel --isolate --shard` as the canonical test command.
1. Wire Prometheus client (`prom-client` pure-JS) into every binary; one shared metrics namespace `sr_*`.

-----

## 2. Ring 1 — The Custom Columnar Event Store

This is the hardest piece and the one most likely to require redesign mid-build. Treat it as such.

### 2.1 Storage model

We use a **hybrid PAX-style layout** (Ailamaki et al., “Weaving Relations for Cache Performance,” VLDB 2001) per **segment**: a segment is a self-contained file holding ~1M rows partitioned by `(project_id, day)`. Inside a segment, each column lives in a contiguous **column chunk** broken into **pages of 8,192 rows** (the page size is a knob; 8k is the right starting point — Pinot uses 10k, Parquet defaults to ~1M row groups with much smaller pages, ORC uses 10k-row stripes). Pure DSM (decomposition-storage-model, one file per column) is rejected because a Sentry event has ~80 narrow columns and we would drown in file-descriptor overhead at our partition cardinality. Pure NSM (row store) is rejected because Discover queries touch 3–8 columns at a time and we want the I/O reduction. PAX wins.

The reference canon — read these before writing a single byte: Stonebraker et al., *“C-Store: A Column-oriented DBMS,”* VLDB 2005; Boncz, Zukowski, Nes, *“MonetDB/X100: Hyper-Pipelining Query Execution,”* CIDR 2005; the Parquet format spec; the ORC spec; the ClickHouse MergeTree source; Druid and Pinot segment formats; QuestDB partition design. Borrow ideas, ship none of their bytes.

### 2.2 Column encodings

Every column chunk header declares one encoding. The catalogue we implement, ordered by where we expect to use each:

|Encoding                           |Where it goes                                                                                             |Reference                                                                                |
|-----------------------------------|----------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
|**Dictionary + bit-packing**       |`project_id`, `environment`, `release`, `platform`, `level`, `type`, `sdk.name`, `os.name`, `browser.name`|C-Store §3, Parquet `PLAIN_DICTIONARY` + `RLE_DICTIONARY`                                |
|**Run-length (RLE)**               |Sort-key prefixes (`project_id`, hour-bucket) — runs of identical values                                  |Parquet `RLE`                                                                            |
|**Delta + frame-of-reference**     |Monotone-ish integer columns: `timestamp`, sequence numbers                                               |Lemire & Boytsov, *“Decoding Billions of Integers per Second Through Vectorization”*     |
|**Gorilla XOR**                    |Float metrics, percentile snapshots, gauge series                                                         |Pelkonen et al., *“Gorilla: A Fast, Scalable, In-Memory Time Series Database,”* VLDB 2015|
|**Raw + ZSTD block compression**   |High-cardinality strings (`event_id`, `message`, `exception.value`, `transaction`)                        |ZSTD level 3 chosen below                                                                |
|**Length-prefixed JSON page + LZ4**|`contexts`, `tags`, `breadcrumbs`, `exception.values`, `spans` — repeated/nested columns                  |LZ4 wins on decompression-bound paths                                                    |

Block compression: **ZSTD level 3 for cold/warm segments, LZ4 for hot in-memory pages.** Snappy is rejected — it does not earn its ratio on our workload. Bun ships `Bun.gzipSync` backed by zlib-ng; for ZSTD/LZ4 we use the WASM builds with a thin FFI fallback to libzstd via `bun:ffi` when WASM is the bottleneck.

### 2.3 Partitioning and sort order

```
data/
  p<project_id>/
    d<yyyymmdd>/
      h<hh>/           # hourly sub-partitions for hot retention (last 24h)
        segment-<ulid>.sr
      manifest.json
```

Primary sort within a segment: `(project_id ASC, timestamp DESC, group_id ASC)`. Secondary block-level indexes per column page: **min/max zonemap**, **bloom filter** (for equality predicates on high-cardinality columns: `group_id`, `trace_id`, `user.hash`, `release`), and **sparse index** of one entry per page. Bloom filters: 10 bits/key, 7 hashes — well-known optimum for 1% FPR.

### 2.4 Schema evolution

Each segment carries a self-describing schema header (column id → (name, type, encoding)). Adding a column means writing new segments with the extended schema. Reads against historical segments return NULL for missing columns. ClickHouse MergeTree and Parquet both do this — we follow Parquet’s column-id approach so renames are free.

### 2.5 Write path — engineering the 10k/s ceiling

Per-shard, single-threaded Bun process. **Shards = 16** by default (one per logical CPU on a 16-core box; revisit on different hardware). Hash by `project_id` modulo shards. Each shard runs:

1. **WAL** (`wal-<seq>.log`, append-only) with **group commit**: fsync no more than every 5 ms or every 256 KiB, whichever comes first. Crash-recovery replays from last checkpoint.
1. **MemTable**: per-partition skip-list keyed by `(timestamp_desc, group_id)`, columnar-staged — incoming events are decomposed into per-column TypedArrays the moment they enter, so we never round-trip through JS objects. Skip-list (not ring buffer) because retention windows can age out items mid-batch.
1. **Flush triggers**: 60 s wall-clock OR 64 MiB memtable size OR 250k rows, whichever first. We emit a segment with column chunks + page indexes + zonemaps + blooms + footer.
1. **Compaction**: **tiered, not levelled**. Reads are dominated by the last 24h; write amplification matters more than read amplification beyond that window. Three tiers: L0 (raw flushes), L1 (≤16 segments merged hourly), L2 (daily merge into one segment per project-day). Target write amplification 3.0×. We measure it; if it exceeds 4.0× we tune. **Compaction does not run inside the shard process** — see §12 Concurrency and Process Topology.
1. **Backpressure**: each shard publishes its WAL lag and memtable saturation; the relay layer reads these via shared memory page (mmap’d `BigInt64Array`) and emits HTTP 429 with `Retry-After` when any shard exceeds 80% saturation.

Concurrency model: **multi-process via `Bun.spawn`, one process per shard, IPC via Unix-domain sockets carrying length-prefixed MsgPack frames** (we keep the wire format MsgPack because Bun’s native JSON is fast enough but MsgPack TypedArray passthrough is faster for columnar batches). No threads inside a shard process — JavaScriptCore is single-threaded by design and Worker overhead is not worth it at this scale.

### 2.6 Read path

A handwritten query planner in TypeScript:

```
SQL-ish AST  →  Logical plan (Select/Filter/Project/Aggregate/Sort/Limit)
             →  Rewrites (predicate pushdown, projection pruning, constant folding)
             →  Physical plan (SegmentScan, VectorFilter, VectorAggregate, …)
             →  Pipeline of vectorised operators, batch size 2,048
             →  Fan-out across query-worker pool (§12) for multi-segment scans
```

**Vectorised execution.** Every operator consumes and produces a `ColumnarBatch` — a record of `{ length: number, columns: Map<ColumnId, TypedArray | Uint8Array[]> }`. Filters compile to **WebAssembly SIMD** kernels (`v128.i32x4.cmp`, `f64x2.cmp`, mask-pack) for equality, range, and `IN (small-set)` predicates. We ship a hand-rolled WAT-to-WASM toolchain at build time; the hot kernels are ~200 bytes each. Vectorised aggregation uses cache-aligned hash tables backed by `Uint32Array` open-addressed probing — no `Map<>`, no object allocation in inner loops.

**Late materialisation.** Decode only the columns named in the output projection plus those required by filters. Predicates push through to the segment reader, which uses min/max zonemaps to skip whole pages and bloom filters to skip equality probes. Aggregations push where possible: `count(*)` becomes a footer-level summation when no filter is present.

**Sampling.** For percentile queries on transaction durations we use **deterministic hash sampling** (FNV-1a of `event_id` modulo N), reproducible across runs. Exact percentiles are computed when the result set is below 100k rows.

**Caching.** Three layers, all LRU (ARC is overkill at our scale and harder to size): hot-page cache (256 MiB), parsed-segment-footer cache (decoded zonemaps and bloom filters, 64 MiB), and a query-result cache keyed by `(plan-hash, segment-set-hash)` with 60s TTL.

**Bun-specific accelerants.** `Bun.file(path).slice(off, end)` for zero-copy mmap-backed page reads; `Bun.gunzipSync` (zlib-ng) for gzip-compressed segments; `Buffer.indexOf` SIMD path for delimiter scans; `Bun.hash.crc32` (PCLMULQDQ-accelerated, ~20× faster) for segment integrity checks.

### 2.7 Approximate data structures

A pure-TS `packages/hll-tdigest`:

- **HyperLogLog++** for unique-users-affected per group/release/environment. Reference: Flajolet, Fusy, Gandouet, Meunier, *“HyperLogLog: the analysis of a near-optimal cardinality estimation algorithm,”* AofA 2007, with Google’s HLL++ improvements (sparse representation, bias correction). Backed by `Uint8Array` of 2^14 registers (16 KiB per HLL, ~1.6% error).
- **T-Digest** for percentile aggregation across partitions. Reference: Dunning & Ertl, *“Computing Extremely Accurate Quantiles Using t-Digests.”* Centroid array as parallel `Float64Array` (means) + `Uint32Array` (counts). Merge is associative — perfect for fan-out aggregation.
- **Count-Min Sketch** for top-N high-cardinality dimensions (top URLs, top user agents). Width 2048, depth 5, with **conservative update** for tighter bounds.
- **Bloom filter** for “does this issue contain user X?” — the same 10 bits/key, 7 hashes used in segment indexes.

### 2.8 Operational notes

- **Disk**: NVMe, **xfs** (better large-file behaviour than ext4 for our 64 MiB segment files), mounted `noatime,nodiratime,discard=async`.
- **Backup**: nightly rsync of the data directory diff plus continuous WAL streaming to S3-compatible storage; recovery is segment manifest replay + WAL tail.
- **Replication**: synchronous WAL streaming primary→replica, single replica. Anything more elaborate is unjustified at 10k events/s with our team size. Failover is manual + scripted, not automatic — automatic failover at this scale invites split-brain pain we cannot afford to debug at 3 a.m.
- **Monitoring**: per-shard `sr_store_write_latency_seconds`, `sr_store_memtable_bytes`, `sr_store_segment_count`, `sr_store_compaction_debt_segments`, `sr_store_query_latency_seconds{quantile}`.
- **Cost target**: ≤ $0.02 per million events stored compressed at 90-day retention. We measure; we publish; we revise.

-----

## 3. Ring 2 — Ingestion at 10k/s on Bun

### 3.1 Edge (Relay-equivalent)

`apps/relay` runs `Bun.serve` with `reusePort: true` across N processes (typically 4 — JavaScriptCore handles 10k req/s on a single core for our envelope shape). Settings:

```ts
Bun.serve({
  port: 9000,
  reusePort: true,
  maxRequestBodySize: 100 * 1024 * 1024, // 100 MiB envelopes (minidumps, attachments)
  idleTimeout: 30,
  async fetch(req) { /* parseEnvelopeStream */ }
})
```

**Streaming envelope parser.** Sentry envelopes are newline-delimited JSON headers interleaved with binary payloads. We consume `req.body` as a `ReadableStream`, run a hand-rolled state machine that emits each `{ header, payloadBytes }` pair without ever buffering attachments. The state machine lives in `packages/proto/src/envelope.ts` and has 100% line coverage by property tests using fast-check.

**PII scrubbing.** Pattern library — email, phone (E.164 + national variants), credit card (Luhn-validated), SSN, IBAN, JWT, bearer tokens, AWS/GCP/Azure secrets — plus per-project denylist regexes. Scrubbing runs over JSON payload Items but never over attachment bodies; large attachments use a separate per-project allowlist.

**Rate limiting.** Leaky bucket per `(project_id, data_category)`. Backing store: Bun’s built-in Redis client on a single-node Redis with AOF, plus an in-process LRU mirror updated via Redis pub/sub for sub-millisecond decisions in the hot path. On Redis outage we fall back to in-memory only with a documented eventual-consistency window.

**Dynamic sampling.** Trace-scoped decisions evaluated server-side per envelope using rules of the form `if event.platform == 'javascript' && event.environment == 'production' { sample: 0.1 }`. Decisions are deterministic on `trace_id` so all envelopes in a trace agree.

**Outcomes.** Every accepted, filtered, rate-limited, invalid, or dropped envelope item emits an `outcome` row to its own outcomes stream, mirroring Sentry’s existing outcome categories. Outcomes are how we honestly answer “where did my events go?”

### 3.2 Custom queue (Kafka-equivalent on Bun)

`apps/queue` is a single-writer, multi-reader segmented log on disk.

- **Topic = `(project_id, data_category)`**, sharded by `hash(project_id) mod N_queue_shards` (typically 8).
- **Segment file**: `topic-<name>/segment-<base-offset>.log` — fixed 256 MiB rolled by size or 1 hour.
- **Durability**: every write goes to WAL, group-committed; the producer ACK is returned only after fsync. Consumers `mmap` the active segment for zero-copy reads and stream sealed segments with `Bun.file(path).stream()`.
- **Consumer offsets** live in `bun:sqlite` (one DB per queue shard) — `(topic, consumer_group, partition)` → `offset, committed_at`. `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL`, `PRAGMA mmap_size=268435456`.
- **Backpressure**: bounded queue depth per topic (default 4 GiB), surfaced as 429 to relay.
- **Replication**: same WAL streaming pattern as the event store — primary→replica synchronous, manual failover.

This is intentionally minimal. NATS JetStream, Redpanda, and the Kafka log paper are the references; we ship a single-host version that survives our 10k/s ceiling and degrades visibly when it cannot.

### 3.3 Workers

`apps/ingest` runs a fixed pool of N=8 Bun processes, each consuming from the queue with **work-stealing across topic partitions** (a worker reads its primary partitions and, when idle, steals from neighbours). Inside a worker, **Effect fibers** handle per-event concurrency. The pipeline:

```
parse  →  validate  →  normalize  →  group  →  symbolicate  →  save
```

Each stage emits a span; per-stage backpressure surfaces via Effect’s built-in `Queue.bounded`. We deliberately keep stages composable but explicit — no implicit retries, no silent dead-letter; every drop is an outcome row.

### 3.4 Grouping engine

`packages/grouping`. We reimplement Sentry’s documented grouping hierarchy: **fingerprint (if supplied) > stack trace > exception > message**. Per-platform stacktrace rules classify in-app vs system frames (Python: prefix `site-packages`; JS: vendor chunks; Java: package allowlist; Swift: Apple framework prefixes; Rust: `std`, `core`, `alloc`; Go: standard library paths). A regex-based fingerprint-rules grammar applies user overrides (`error.type:DatabaseError -> db-error`). `GroupHash` lookup hits the metadata shard; create-if-missing wraps in an UPSERT with a unique constraint so concurrent ingestion never duplicates groups.

A secondary process runs the AI-assisted regroup pass — embedding similarity over `(exception_type, top_frame_module, top_frame_function, message_stem)` — flagging candidate merges for human approval. We do not auto-merge.

### 3.5 Symbolication

`packages/symbolicator-native/` is one Rust workspace, single source, dual target. The core is pure logic — bytes in, frames out, no `std::fs`, no threads, no I/O — wrapping `gimli` (DWARF), `pdb` (Microsoft PDB), `symbolic-debuginfo` (Breakpad, dSYM, ELF), and stackwalking for minidumps. Two thin shim modules sit on top, gated by Cargo features:

```rust
// src/lib.rs — shared pure-logic core
mod core {
    pub fn symbolicate(debug_bytes: &[u8], fmt: DebugFormat, addr: u64)
        -> Result<Frame, SymError>;
}
#[cfg(feature = "ffi")]  mod ffi  { /* extern "C" wrappers */ }
#[cfg(feature = "wasm")] mod wasm { /* wasm-bindgen wrappers */ }
```

**Bun target.** `cargo build --release --features ffi --crate-type cdylib` produces `libsymbolicator.so`, loaded via `bun:ffi` `dlopen()` with `FFIType` signatures. Native speed. The orchestrator, caching layer, debug-info upload endpoint, and HTTP surface all live in TypeScript; Rust touches the bytes of debug files and nothing else.

**Cloudflare target.** `wasm-pack build --release --features wasm --target web` produces a `.wasm` module plus JS bindings, imported into the Worker via a `CompiledWasm` rule in `wrangler.jsonc`. The Worker pulls debug files from R2, instantiates the WASM module (cached per-isolate after first call), returns symbolicated frames. No Bun service to call into. No always-on tier. Cold-start cost on the first symbolication per fresh isolate is ~10–50 ms for module instantiation; amortised across the isolate’s lifetime it disappears. SymCache-style pre-decoded artefacts cache to R2 keyed by `debug_id`, so the WASM module only does full debug-info parsing on the first frame for any given file across the entire fleet.

**WASM size budget.** After `wasm-opt -Oz`, a gimli + pdb + minimal `symbolic-debuginfo` build typically lands in the 2–4 MiB range. Verify the current Worker bundle limit when you build — Cloudflare has moved it more than once and figures quoted in prior conversations may be stale. Trim feature flags ruthlessly if you approach the ceiling. If a debug format is genuinely too expensive in bytes to justify, ship it only in the Bun build and document the gap rather than degrade the WASM module.

**JavaScript source maps** — entirely in TypeScript. No Rust, no WASM. Parse the v3 source-map spec, decode VLQ, resolve original positions, handle `debug-id` linkage and artifact bundles. Same code on Bun and on Workers. Well-bounded work; budget about three engineer-weeks.

**Debug-info upload endpoint** at `/api/{org}/projects/{project}/files/dsyms/`, content-addressed by `debug_id` per Sentry’s documented UUID5 scheme. Bun deployment stores on local NVMe with an S3-compatible mirror and an LRU on-disk cache of decoded artefacts. Cloudflare deployment uses R2 for raw debug files, R2 again for decoded SymCache artefacts (cheap cross-region reads, zero egress fees), and an in-isolate LRU for hot frames backed by Workers KV with short TTLs for cross-isolate sharing — `(debug_id, instruction_addr)` resolves identically everywhere on Earth, so eventual consistency is the right model.

**Caching** of symbolicated frames keyed by `(debug_id, instruction_addr)`. Both deployments maintain a process-local LRU; the difference is the tier behind it (on-disk vs KV).

JVM/ProGuard symbolication is deferred — not required by our five internal services and explicitly out-of-scope for P0.

-----

## 4. Ring 3 — Five Client SDKs

Every SDK implements the same six contracts: DSN parsing, envelope construction, `sentry-trace` + `baggage` + W3C `traceparent` propagation, Client → Scope → Hub architecture, offline persistent transport queue, before-send hooks. Each SDK MUST pass the `sdk-conformance` corpus byte-for-byte (modulo SDK metadata).

### 4.1 TypeScript / JavaScript (`sdks/javascript`)

Three entry points: browser, Node/Bun, edge.

- **Browser**: `window.onerror`, `window.onunhandledrejection`, `BrowserClient`, fetch+XHR instrumentation, replay integration, `web-vitals` integration via `PerformanceObserver`.
- **Node/Bun**: `process.on('uncaughtException')`, `process.on('unhandledRejection')`, `node:http` and Bun’s native HTTP server instrumentation, native crash capture via `worker_threads`. Must run on Bun without polyfills.
- **Edge**: Cloudflare Workers and Deno compatibility, no `process` or `fs`. Transport degrades to fire-and-forget with `event.waitUntil`.
- **Build-time plugins**: Vite, webpack, esbuild — source-map upload, release injection, `debug-id` injection per the Sentry bundler-plugin design.

### 4.2 Rust (`sdks/rust`)

The user’s stack uses Rust heavily; this SDK is treated with the same seriousness as the TypeScript one.

- Crate structure: `sentry-replica-core`, `-types`, `-transport`, `-panic`, `-anyhow`, `-eyre`, `-tracing`, `-tower`, `-actix`, `-axum`, `-tokio`.
- Sync and async APIs; tokio is primary, async-std and smol are feature-gated.
- Panic hook via `std::panic::set_hook`; error trait integrations for `anyhow`, `eyre`, `thiserror`, `color-eyre`.
- `tracing-subscriber` layer emitting Sentry spans.
- Backtrace capture via `std::backtrace::Backtrace` + the `backtrace` crate; symbolication uses `debug_id` headers so the server can resolve frames.
- Native crash handler via `minidumper` / `crash-handler`, posting minidumps as envelope attachments.
- Cargo features: `default = ["transport-http"]`, optional `tracing`, `tower`, `axum`, `actix-web`, `tokio`, `async-std`, `minidump`.
- `no_std` build target gated behind `--no-default-features` for embedded reachability; transport reduces to caller-supplied function pointer.

### 4.3 Go (`sdks/go`)

- Idiomatic API: `sentry.Init(opts)`, `sentry.CaptureException(err)`, `sentry.WithScope(func(*Scope))`.
- Middleware for `net/http`, `gin`, `echo`, `chi`, `fiber`.
- `context.Context` propagation; `sentry-trace` and `baggage` extracted/injected via `propagation.TextMapPropagator`.
- `defer sentry.Recover()` for panic capture.
- Goroutine-safe `Hub` via per-goroutine clones; matches the existing `getsentry/sentry-go` design.
- Logging integrations: `slog`, `zap`, `zerolog`, `go-kit/log`.

### 4.4 Python (`sdks/python`)

- `sys.excepthook`, `threading.excepthook`, `asyncio` via `loop.set_exception_handler`.
- Framework integrations: Django (middleware + signals), Flask (`got_request_exception`), FastAPI/Starlette ASGI middleware, AIOHTTP, Celery (signals), AWS Lambda, GCP Functions.
- WSGI + ASGI generic middleware.
- `logging.Handler` integration with breadcrumb capture.
- Profiling via in-process sampling profiler (40 Hz default, configurable; `signal.setitimer(ITIMER_PROF)` on POSIX, sampling thread on Windows).
- Async context propagation via `contextvars` — this is how scope follows tasks.

### 4.5 Swift (`sdks/swift`)

- SwiftUI and UIKit auto-instrumentation: view lifecycle, navigation transitions.
- `URLSession` swizzling for HTTP spans.
- Crash handling via signal handlers and Mach exception ports; minidumps generated client-side and posted as attachments.
- `dSYM` upload via Xcode build phase script (`sentry-replica-cli upload-dif`).
- Platform matrix at P0: iOS 16+, macOS 13+, tvOS 16+, watchOS 9+, visionOS 1+.
- Swift Concurrency context: `TaskLocal` for scope propagation across `async let`, `TaskGroup`, `Task.detached`.
- Combine integration: `Publisher` extension `.captureSentryErrors()`.
- Distribution: SwiftPM primary, CocoaPods secondary.

### 4.6 Cross-SDK conformance

The `packages/sdk-conformance` test corpus is the law. It ships:

1. **Envelope fixtures** — every event/transaction/profile/log/attachment shape with expected byte output.
1. **DSN parsing cases** — including malformed DSNs and reserved characters.
1. **Trace propagation cases** — `sentry-trace`, `baggage`, `traceparent` interop, including continuation, head-of-trace, and the `propagateTraceparent: true` path required by OTel coexistence.
1. **End-to-end** — each SDK spawns a real process, throws each error type from the corpus, asserts the event surfaces in the replica within 5 seconds. The “≤5 minute first-event experience” is a CI gate, not a marketing claim.

-----

## 5. Ring 4 — The Full Product Surface

Each feature gets implementation guidance; none are deferred.

1. **Errors / Issues** — capture, group (Ring 2), state machine `unresolved → resolved → regressed → escalated`, link to releases/commits via `tags.release`.
1. **Performance / Tracing** — transactions, spans (`packages/proto/span.ts`), trace view, p50–p100, trends and regression detection via z-score over rolling window per `(project, transaction)`.
1. **Profiling** — sampled profiles attached to transactions as envelope items (`profile`, `profile_chunk`); flame graph rendered in the UI from the `Profile` payload. Continuous profiling via `profile_chunk` items.
1. **Session Replay** — DOM/event/network capture using rrweb (or a vendored equivalent if we want tighter control over capture semantics). Capture is a bounded leaf concern, not a system, so using a library here doesn’t violate the build-it-ourselves rule. Server stores recordings as compressed Item streams keyed by `replay_id`; player is a React 19.2 component.
1. **Crons** — `check-in` Item type; scheduler watches expected vs received intervals, emits missed/over-runtime alerts.
1. **Uptime** — internal probe workers fire HTTP requests at configured intervals with body-match and SSL-expiry checks; results feed the same alert plumbing.
1. **Releases** — version tagging, deploy events, commit attribution via GitHub/GitLab integration, **suspect commits** by intersecting `release.commits` with the in-app frames of the issue’s stack trace, crash-free sessions/users computed from `session` Items.
1. **User Feedback** — modal-captured reports linked by `event_id`; AI-synthesised feedback summaries via Seer.
1. **Discover / Explore** — ad-hoc query over the columnar store; SQL-ish syntax in the API, no exposed user-facing SQL (avoid injection surface).
1. **Dashboards** — pinnable widgets backed by query specs; live update via the WebSocket channel.
1. **Alerts** — Issue Alerts (event count / unique users), Metric Alerts (over the metric store), Uptime Alerts, Cron Alerts. Rule evaluation runs every 60 seconds in the alert worker pool (§12).
1. **Integrations** — Slack, Discord, PagerDuty, Jira, Linear, GitHub, GitLab, generic webhooks. Webhook signing uses HMAC-SHA256 over the body.
1. **Logs (OTLP)** — endpoint `/api/{project_id}/integration/otlp/v1/logs/`; SDKs also send via the Sentry log envelope per the docs.
1. **Metrics** — first-party statsd-style envelope items. We document why we, like Sentry, do not accept OTLP metrics: the OTLP metrics model (delta vs cumulative, exemplars) is poorly aligned with our percentile-first query patterns over T-Digest; we revisit if customer demand surfaces.
1. **Seer-equivalent** — issue triage worker that, given an issue, asks an LLM with context `(stacktrace, breadcrumbs, suspect commit diff)` for a probable root cause and suggested fix. Strictly advisory; never auto-resolves.
1. **Admin / Multi-tenancy** — orgs, teams, projects, members, roles `(Owner, Manager, Admin, Member, Billing, ReadOnly)`, SSO via OIDC, SCIM v2, audit log (append-only `bun:sqlite` table per org), per-project quotas, dynamic sampling rules.

-----

## 6. Ring 5 — OpenTelemetry Interop

- **OTLP/HTTP and OTLP/gRPC traces** at `/api/{project_id}/integration/otlp/v1/traces/`. We decode protobuf via a hand-rolled decoder generated from the OTLP `.proto` files; gRPC over HTTP/2 uses Bun’s experimental HTTP/2 server (1.3.14).
- **OTLP/HTTP logs** at `/api/{project_id}/integration/otlp/v1/logs/`. Mapped to our log envelope shape.
- **No OTLP metrics** — see §5.14. Document the reasoning in the public docs so users understand it is a considered position, not an omission.
- **Coexistence in each SDK**: when `propagateTraceparent: true`, the SDK emits `sentry-trace`, `baggage`, *and* `traceparent`; the reverse-direction extraction accepts any of the three. This is the precise behaviour the Sentry docs codify.

-----

## 7. Ring 6 — Web UI

`apps/web`. React 19.2.x with the React Compiler enabled, Tailwind v4.3 via `@tailwindcss/vite` (we run inside Bun’s bundler — `bun build` directly, no Vite for production builds, Vite only for `bun --hot` dev iteration). shadcn/ui as the base; customised heavily.

**Design system.**

- Typography: Inter for UI; JetBrains Mono for code.
- Colour: Sentry purple `#7553FF` as the primary; neutral grays defined as `oklch()` values in `@theme` (Tailwind v4 idiom).
- Dark mode default; light mode flipped via `class="light"` on `<html>`.
- Scrollbars: `scrollbar-thin scrollbar-thumb-neutral-700` via v4.3 utilities.

**Route map (abridged):**

```
/                           → org dashboard
/issues                     → issue stream
/issues/:id                 → issue details, events tab, breadcrumbs, related
/performance                → transaction overview, p95 trends
/traces/:traceId            → trace waterfall
/profiling                  → profile list + flame graphs
/replays/:replayId          → replay player
/discover                   → ad-hoc query builder
/dashboards/:id             → custom dashboards
/alerts                     → alert rules + active alerts
/crons                      → cron monitors
/uptime                     → uptime monitors
/releases                   → release health
/settings/{org,team,project,account}
```

**Live updates.** A single WebSocket per browser tab multiplexes subscriptions: `(channel, key)` pairs. Channels: `issue.events`, `alert.fires`, `deploy.events`, `stats.deltas`, `replay.live`. Server-side, a dedicated WebSocket fanout proc (§12) fanned out via Bun’s Redis pub/sub keeps per-org client counts under 5,000 on one node.

**Charts.** No D3 hand-wiring for the main charts — we use Visx (MIT). Flame graphs are custom Canvas2D with virtualised rendering; at 200k frames they still hit 60 fps.

-----

## 8. Ring 7 — Multi-tenancy, Auth, Security

- **Hierarchy**: Org → Team → Project → Member. Roles `Owner > Manager > Admin > Member > Billing > ReadOnly`.
- **DSN management**: `(public_key, project_id, secret)` triples; rotation creates a new key while leaving the old valid for a 7-day grace; revoke is immediate.
- **Auth**: email + password (`Bun.password.hash(pw, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 })`), session cookies (HttpOnly, Secure, SameSite=Lax) backed by Redis, OAuth2 via GitHub, GitLab, Google, SCIM v2 endpoint at `/api/scim/v2/`.
- **Service tokens** with scoped permissions (`event:write`, `project:read`, `org:admin`); stored as `(prefix, sha256(secret))` so the secret is unrecoverable post-issue.
- **Audit log**: append-only table per org, retained 13 months, exposed at `/settings/audit-log`.
- **PII scrubbing**: per-project rules; defaults conservative.
- **Per-project rate limits and quotas**: enforced in relay (Ring 2.1).
- **Dynamic sampling rules**: stored as ordered list per project; first match wins; evaluated server-side at relay.

-----

## 9. Ring 8 — `bun:sqlite` Sharding for Metadata

Events live in the columnar store; metadata lives in `bun:sqlite`. The metadata workload at 10k events/s is dominated by group-update writes — roughly one row update per event group hit per minute (after the first occurrence), call it ~2k writes/s sustained over the metadata shards.

- **Shard key**: `project_id` modulo `S` (default `S=8`). Each shard is one SQLite file owned by one Bun process (§12).
- **Pragmas (per shard)**: `journal_mode=WAL`, `synchronous=NORMAL`, `cache_size=-262144` (256 MiB), `mmap_size=1073741824` (1 GiB), `temp_store=MEMORY`, `wal_autocheckpoint=10000`.
- **Cross-shard queries** (e.g. “all groups for org X across projects on shards 0, 3, 5”) fan out via the same Unix-socket IPC pattern as the columnar store; results merged in the API process.
- **Schema highlights** (illustrative — full DDL lives in `apps/api/src/db/schema.sql`):

```sql
CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  group_hash BLOB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unresolved','resolved','ignored','regressed')),
  level TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  times_seen INTEGER NOT NULL DEFAULT 1,
  message TEXT,
  culprit TEXT,
  platform TEXT,
  UNIQUE(project_id, group_hash)
);
CREATE INDEX idx_groups_project_last_seen ON groups(project_id, last_seen DESC);
```

- **Backup**: per-shard `.backup` via SQLite’s online backup API every 15 minutes; WAL streamed continuously to S3.
- **Replication**: Litestream-style WAL streaming to a read replica per shard. Promotion is manual.

-----

## 10. Ring 9 — Self-Observability (Dogfooding)

The replica observes itself via its own JS SDK and Rust SDK. Self-instrumentation budget: **the replica’s own telemetry MUST NOT exceed 5% of its own throughput.** At 10k events/s that is 500 events/s of self-telemetry, which is plenty.

- Self-trace sampling: 1% for normal operation, 100% during incidents (toggled by a `SELF_TRACE_RATE` env var).
- Metrics exposed at `/internal/metrics` (Prometheus text format): `sr_ingest_*`, `sr_store_*`, `sr_queue_*`, `sr_grouping_*`, `sr_symbolicator_*`, `sr_alert_eval_*`, `sr_ui_ws_*`.
- Health endpoints: `/internal/healthz` (process alive), `/internal/readyz` (dependencies reachable), `/internal/startupz` (startup complete).

-----

## 11. Ring 10 — Tests

Tests are first-class. They run on every commit.

- **Unit**: `bun test --parallel --isolate`. Target ≥ 90% line coverage on `packages/proto`, `packages/columnar`, `packages/grouping`, `packages/queue-core`.
- **Property tests** via fast-check on the envelope parser, grouping engine, T-Digest merge, HLL union, segment encode/decode round-trip.
- **SDK conformance**: each SDK is driven against a local replica instance; envelope byte-equivalence is checked modulo SDK-metadata fields. CI fails on any divergence.
- **End-to-end crash tests**: spawn a real process in each of five languages, throw each canonical error (null deref, division by zero, panic, unhandled rejection, OOM, segfault via deliberate UB), assert appearance in the replica UI within 5 seconds.
- **Performance benchmarks** (`infra/bench`): p50/p95/p99 for envelope ingest, group lookup, Discover query, alert eval. Published as a Grafana dashboard.
- **Failure-mode tests**: kill the queue mid-event, kill a worker mid-symbolication, fill the disk (loopback fs), exhaust WAL, hit rate limits. Each has a named, codified scenario.
- **Load test**: a synthetic generator in `infra/loadgen` produces a realistic event mix (70% errors, 20% transactions, 5% sessions, 3% logs, 2% attachments) at 10k events/s for 1 hour. Pass criteria: **p99 ingest latency < 100 ms, zero dropped events, monotonic queue depth not exceeding 30% of bound.**

-----

## 12. Concurrency and Process Topology

This is the canonical reference for how the replica runs at the OS level. Every other section that says “a process” or “a worker pool” links back here. When in doubt about where something runs, this section is authoritative.

### 12.1 Process inventory

Reference hardware: a 32-core production box, NVMe-attached, 256 GiB RAM. Counts below are starting points; §12.2 gives the formulas for scaling them. Every count is a knob, not a constant.

|Process kind         |Purpose                                                     |Primitive                |Count (32-core)                    |IPC contract                                                                       |
|---------------------|------------------------------------------------------------|-------------------------|-----------------------------------|-----------------------------------------------------------------------------------|
|**Relay**            |HTTP edge, envelope parse, scrubbing, rate-limit, sampling  |`Bun.serve` + `reusePort`|4                                  |Stateless; writes to queue shards over Unix socket                                 |
|**Queue shard**      |Single-writer segmented log for one queue partition         |`Bun.spawn`              |8                                  |Producers connect over Unix socket; consumers `mmap` segment files directly        |
|**Metadata shard**   |One `bun:sqlite` file owned exclusively                     |`Bun.spawn`              |8                                  |Length-prefixed MsgPack over Unix socket; cross-shard fanout via API               |
|**Ingest worker**    |parse → validate → normalize → group → symbolicate → save   |`Bun.spawn`              |8                                  |Pulls from queue shards; writes to columnar shards                                 |
|**Columnar shard**   |MemTable + WAL + flush for one `project_id` modulo-16 bucket|`Bun.spawn`              |16                                 |MsgPack over Unix socket; one socket per shard                                     |
|**Compactor**        |L1 → L2 segment merges; runs outside shard process          |`Bun.spawn`              |8                                  |Shard hands MsgPack job spec over socket; compactor ACKs after atomic manifest swap|
|**Query worker**     |Per-segment scan during Discover/dashboard fan-out          |`worker_threads`         |8                                  |`SharedArrayBuffer` for batch handoff; coordinated by API process                  |
|**API**              |GraphQL + REST query layer                                  |`Bun.serve` + `reusePort`|4                                  |Stateless; calls shards/queue/store over Unix sockets                              |
|**WebSocket fanout** |Live updates to browser tabs                                |`Bun.serve` + `reusePort`|2                                  |Redis pub/sub for cross-proc broadcast                                             |
|**Alert coordinator**|Pulls due rules from metadata, dispatches                   |`Bun.spawn`              |1 (leader-elected via Redis SET-NX)|Unix sockets to evaluators                                                         |
|**Alert evaluator**  |Evaluates batch of rules against fresh data                 |`Bun.spawn`              |4                                  |Returns results to coordinator over Unix socket                                    |
|**Seer**             |LLM-mediated issue triage                                   |`Bun.spawn`              |1                                  |Pulls from queue; writes recommendations to metadata                               |
|**Cron leader**      |Schedule evaluation, retention sweep, manifest GC           |`Bun.spawn`              |1 (leader-elected)                 |None outbound; reads metadata, writes to columnar shards’ retention queue          |
|**Uptime prober**    |HTTP probe workers                                          |`Bun.spawn`              |2                                  |Pulls config from metadata; emits envelopes through relay                          |

Approximately 75 processes on the reference box. Some over-subscription is intentional: not all processes are CPU-bound. The CPU-bound bucket (ingest workers, columnar shards, compactors, query workers, alert evaluators) totals ~44 procs — well above core count, but only fraction-of-a-second-burst contended; the others are I/O-bound or idle most of the time. Bun’s process footprint (RSS ~30–60 MiB per idle proc) makes this comfortable on 256 GiB.

### 12.2 Sizing formulas

Let `C` = number of logical CPU cores on the host.

```
relay_procs            = max(2, C / 8)        # network-bound, reusePort
columnar_shards        = C                    # one per logical core
queue_shards           = C / 4                # mmap-heavy, not CPU-heavy
metadata_shards        = C / 4
ingest_workers         = C / 4
compaction_workers     = C / 4
query_workers          = C / 4
api_procs              = max(2, C / 8)
ws_fanout_procs        = 2                    # constant; scale up only if >5k concurrent tabs
alert_evaluators       = max(4, projects / 100)
alert_coordinator      = 1                    # leader-elected
seer_workers           = 1                    # LLM-bound; scale only on backlog
cron_leader            = 1                    # leader-elected
uptime_probers         = max(2, monitors / 500)
```

**Reference hardware sizes:**

- 8-core box (minimum): 16 columnar / 2 queue / 2 metadata / 2 ingest / 2 compactors / 2 query / 2 relay / 2 API / 2 WS / 4 alert workers = ~40 procs. Workable at 10k events/s but no headroom. **Not recommended.**
- 16-core box (acceptable): 16 columnar / 4 queue / 4 metadata / 4 ingest / 4 compactors / 4 query / 2 relay / 2 API / 2 WS / 4 alert = ~50 procs. Sustains 10k/s with comfortable margins.
- 32-core box (recommended production): see §12.1 inventory; ~75 procs; sustains 10k/s with significant peak headroom up to ~25k brief.
- 64-core box: linearly scales every formula; expected ceiling ~25k/s sustained or ~50k brief.

The columnar-shard count is the load-bearing dimension. Scaling shards changes the hash distribution and forces a (manual, scripted) data redistribution. Choose the production shard count at the front and stick with it; resize only at planned maintenance windows.

### 12.3 Primitive choice: `Bun.spawn` vs `worker_threads`

This is a deliberate choice per process kind, not a coin flip.

**Use `Bun.spawn` (full OS process) when:**

- Crash isolation matters: one process going down must not take down others. Shards, compactors, alert evaluators, seer.
- Separate memory budgets matter: a single shard’s MemTable should not compete with another’s.
- Distinct file-descriptor tables matter: queue shards each own a different segment-file FD set.
- The work is stateful and long-lived: shards hold MemTables across hours.

**Use `worker_threads` with `SharedArrayBuffer` + `Atomics` when:**

- Fast IPC matters more than crash isolation: query workers stream columnar batches to a coordinator inside the API process.
- Shared mutable state is the natural model: real-time stats counters fed back to relay backpressure live in a `SharedArrayBuffer` updated by every shard’s monitor thread, read by every relay proc.
- The work is transient compute: a query scan finishes in milliseconds; spawning a process per query would be absurd.

A practical heuristic: **process pools for stateful long-lived workers; worker threads for transient compute that benefits from shared memory and fast IPC.**

### 12.4 IPC patterns

Three patterns are sanctioned. Anything else needs a §12 amendment before it ships.

1. **Length-prefixed MsgPack frames over Unix domain sockets.** Used for shard RPC, coordinator→evaluator dispatch, ingest-worker→columnar-shard writes, API→shard queries. Schema lives in `packages/proto/src/rpc.ts` with a single Effect Schema definition that produces both encoder and decoder, statically typed. Frame format: `u32 length | msgpack bytes`. We do not negotiate protocol versions on the socket; we restart all processes on a wire-format bump.
1. **`mmap`’d queue segment files.** Used by ingest workers to consume from queue shards without going through the queue process. The queue shard owns writes; consumers map the segment read-only. Consumer offsets live in the queue shard’s `bun:sqlite` and are advanced by the consumer over Unix socket.
1. **`SharedArrayBuffer` + `Atomics` within a process.** Used by query workers (`worker_threads`) to hand columnar batches back to the query coordinator without copying. Also used for cross-proc real-time counters via a tiny shared-memory file mapped into every proc — relay reads shard saturation here in the hot path.

We do not use Redis for primary RPC. Redis is for pub/sub broadcast (WebSocket fanout, leader election), session cache, and rate-limit state — not for synchronous request/response in the ingest path. The latency tax is real.

### 12.5 Supervision

Each process kind has a **supervisor process** (one per kind, started by systemd). The supervisor:

- Spawns the initial pool via `Bun.spawn`.
- Monitors child stdout/stderr for the structured `[FATAL]` marker and for non-zero exit.
- Restarts with exponential backoff: 100 ms, 200 ms, 400 ms, 800 ms, 1.6 s, capped at 5 s. After 10 consecutive failed starts the supervisor itself exits with a non-zero code, surfacing the problem to systemd and to the on-call alert.
- Bounces all children on config-file change (SIGHUP).
- Reports per-child state to Prometheus at `/internal/supervisor/metrics`.

Hierarchy: `systemd → supervisor (one per kind) → workers`. Three layers, each with one responsibility. Resist the urge to nest deeper.

`infra/systemd/` ships one unit file per supervisor:

```
sr-relay.service
sr-queue.service          # supervises queue shards
sr-metadata.service       # supervises metadata shards
sr-ingest.service
sr-columnar.service       # supervises columnar shards
sr-compactor.service
sr-api.service            # supervises API procs and query workers (worker_threads inside)
sr-ws-fanout.service
sr-alert.service          # supervises coordinator + evaluators
sr-seer.service
sr-cron.service
sr-uptime.service
```

### 12.6 Crash isolation guarantees

A crash in column X does not affect column Y. The replica’s reliability story is built on this table being true; CI failure-mode tests (§11) verify it for every row.

|If this crashes…   |…these keep running                          |…this is the recovery path                                                                                   |
|-------------------|---------------------------------------------|-------------------------------------------------------------------------------------------------------------|
|One relay proc     |Other relay procs (reusePort), all downstream|systemd respawn; in-flight requests fail with 503, client retries                                            |
|One ingest worker  |Other ingest workers, all shards             |Supervisor respawn; queue consumer offset only commits after columnar save ACK, so no event loss             |
|One columnar shard |Other shards, ingest, relay, API             |Shard respawn replays WAL; in-flight writes ACK’d only after WAL fsync, so no event loss                     |
|One compactor      |All shards (compaction pauses for that tier) |Supervisor respawn; partial output segment is discarded (atomic manifest swap means no partial state visible)|
|One query worker   |API, other query workers                     |Coordinator marks scan as failed, returns partial results with a warning header; client may retry            |
|One alert evaluator|Coordinator, other evaluators                |Coordinator’s batch retries on next 60 s tick                                                                |
|Alert coordinator  |All evaluators (they idle)                   |Leader election picks a new coordinator from a standby pool; evaluator results are idempotent                |
|Seer worker        |Everything else (Seer is advisory)           |Restart; missed recommendations are best-effort                                                              |
|One queue shard    |Other queue shards, ingest, relay            |Relay routes around (queue is sharded by `project_id`); systemd respawn replays WAL                          |
|One metadata shard |Other metadata shards                        |Cross-shard queries return partial; per-shard writes block until respawn                                     |

### 12.7 What NOT to fan out

Three places multi-processing is tempting and wrong:

1. **The relay’s envelope parser, beyond `reusePort`.** Adding more procs adds IPC overhead with no scan-throughput gain — `reusePort` already gives us kernel-level load balancing across the existing pool. Tune proc count, not architecture.
1. **A single event’s stacktrace frames during symbolication.** Parallelism comes from parallel events, not parallel frames within one event. Frames within an event are sequentially dependent on lookups in the same debug-file cache.
1. **Per-shard skip-list operations.** Skip-lists demand consistent ordering; concurrent inserts within a shard break the invariant. The shard process is single-threaded for a reason.

A fourth, more tentative one: **decoupling WAL fsync to a separate process.** The IPC cost likely exceeds the fsync syscall itself once group commit is tuned (which is why the 5 ms / 256 KiB threshold exists). Worth measuring before committing — but the prior is “no.”

### 12.8 Process names and `prctl(PR_SET_NAME)`

Every process sets its own name visible to `ps` and `top`. This is non-negotiable when debugging at 3 a.m.

```
sr-relay-0           sr-queue-0     sr-meta-0
sr-relay-1           sr-queue-1     sr-meta-1
…
sr-columnar-0        sr-compactor-0
sr-columnar-1        sr-compactor-1
…
sr-api-0             sr-ws-0
sr-alert-coord       sr-alert-eval-0
sr-seer              sr-cron        sr-uptime-0
```

Implement via `Bun.spawn({ argv: [...], execArgv: [`–title=sr-columnar-${i}`] })` where supported, or via writing to `/proc/self/comm` on Linux at process start. We verify in `infra/bench/process-names-test.sh` that every process is identifiable.

-----

## 13. Engineering-Honest Component Estimates

For a 1–2 person team. These are tight but achievable; they are not aspirational.

|Component                                            |Weeks               |Risk    |Ops complexity|Depends on     |
|-----------------------------------------------------|--------------------|--------|--------------|---------------|
|Repo scaffold, CI, tsgo                              |1                   |Low     |Low           |—              |
|Envelope proto + DSN + propagation (`packages/proto`)|2                   |Low     |Low           |—              |
|Columnar store kernel (Ring 1)                       |**10–14**           |**High**|**High**      |proto          |
|HLL / T-Digest / CM-Sketch                           |1                   |Low     |Low           |—              |
|Custom queue (Ring 2.2)                              |4                   |Medium  |Medium        |—              |
|Relay edge service                                   |3                   |Medium  |Medium        |queue, proto   |
|Grouping engine                                      |2                   |Medium  |Low           |proto, metadata|
|Symbolicator (JS only)                               |3                   |Medium  |Medium        |proto          |
|Symbolicator (native via Rust FFI + WASM)            |5                   |High    |Medium        |Rust crate     |
|Metadata shards + SQLite                             |2                   |Low     |Medium        |—              |
|Concurrency topology (§12) + supervisors             |2                   |Medium  |Medium        |every ring     |
|Alerts + uptime + crons                              |3                   |Low     |Low           |store, metadata|
|Releases + commit attribution + Seer                 |3                   |Medium  |Low           |integrations   |
|Replay capture+player                                |4                   |Medium  |Medium        |UI             |
|Profiling end-to-end                                 |3                   |Medium  |Medium        |proto, UI      |
|Web UI (every screen)                                |8                   |Medium  |Low           |api            |
|Multi-tenancy, auth, SCIM                            |3                   |Medium  |Medium        |metadata       |
|OTLP traces + logs ingestion                         |2                   |Low     |Low           |proto          |
|**SDK: TypeScript/JavaScript**                       |4                   |Medium  |Medium        |proto          |
|**SDK: Rust**                                        |4                   |Medium  |Medium        |proto          |
|**SDK: Go**                                          |3                   |Low     |Low           |proto          |
|**SDK: Python**                                      |3                   |Low     |Low           |proto          |
|**SDK: Swift**                                       |4                   |Medium  |Medium        |proto          |
|Conformance corpus + e2e                             |3                   |Medium  |Low           |all SDKs       |
|Load testing + tuning                                |3                   |Medium  |Low           |everything     |
|**Total**                                            |**~88 person-weeks**|        |              |               |

For 2 engineers in parallel this is roughly 10–11 months of focused work. With one engineer it is 19–22 months and the columnar store will dominate calendar time.

-----

## 14. Honest Constraints — What Will Hurt

Five places I expect you to push back when reality disagrees.

**The columnar store is the highest-risk component.** Twelve weeks is the optimistic floor. If we discover during the write-amplification audit that tiered compaction does not hold at 10k/s sustained — and there is a real chance we will — we will need to switch to levelled compaction or accept a hotter compaction debt. Plan for redesign once between Rings 1 and 2.

**WebAssembly SIMD in Bun is fast but it is not Arrow.** We will not match DataFusion’s vectorised execution throughput. We will be within 2–3× on filtered scans and within 5× on group-by aggregations at typical batch sizes. For our 10k/s ingest and ~30 QPS Discover load, that is enough. For 100k/s and 300 QPS Discover, it would not be — and we should say so plainly when the use case grows.

**Bun is moving under our feet.** 1.3.14 is the last Zig release; Bun is migrating to Rust. We pin 1.3.14 in production. We test against the Rust-rewrite previews in CI. We do not adopt the Rust rewrite in production until it has been in the wild for at least three months with no regressions on our load corpus. Resist the urge.

**Effect v4 beta is beta.** APIs will shift between beta releases. Pin a single beta version; upgrade deliberately; carry the workarounds for known restricted-runtime issues. Use `effect/unstable/*` only where the alternative is significantly worse — those modules can break in minor versions.

**The TypeScript 7 native preview cannot emit `.d.ts` yet.** For now we ship type checking via `tsgo` and declaration emit via `tsc`. When `tsgo` reaches emit parity we drop `tsc` entirely. Track the migration in `infra/ci/typescript-migration.md`.

**Symbolicator native is the only place we accept third-party complexity in TypeScript-land — and we accept it via FFI to Rust, not via a server hop.** This is a deliberate trade. Pure-TS DWARF/PDB parsing is a six-month project; `gimli` + `pdb` + `symbolic` give us months back. If the FFI boundary becomes a stability problem we accept the rebuild; until then it earns its keep.

**The Cloudflare deployment’s symbolicator runs on WebAssembly, with everything that implies.** Cold-start instantiation, bundle-size budget, no threads, no `SharedArrayBuffer`, no fallback to a hosted tier. A representative gimli + pdb + minimal `symbolic-debuginfo` build measures 2–4 MiB after `wasm-opt -Oz` — comfortably under current Workers limits, but the budget is finite and Cloudflare adjusts it periodically. If a future debug format blows the budget, ship it only in the Bun build and document the gap rather than degrade the WASM module to fit. Do not add an always-on auxiliary tier to solve cold starts; the scale-to-zero rule from §0 forbids it.

**Do not ship session replay without a privacy audit.** Default-deny scrubbing of `<input>` values, `aria-label`, and any element matching `[data-sentry-mask]` and `.sensitive`. Replays are the single feature most likely to leak data we do not own.

**Five SDKs at production grade is the largest single line of effort.** It is non-negotiable — the use case is five internal services in five languages. Sequence Rust and TypeScript first (the user’s two heaviest stacks), then Python, then Go, then Swift. Conformance corpus comes online with the second SDK, not the fifth.

**Process count is operational complexity in disguise.** Seventy-five processes on a reference box is fine when it works and a debugging nightmare when it does not. Invest in §12.5 supervision and §12.8 process naming before the first 3 a.m. incident, not after.

-----

## 15. Closing — How to Read This Document

Treat each Ring as a milestone. Do not skip ahead; the columnar store cannot be retrofitted to an ingestion pipeline that was built assuming Kafka semantics, and the SDKs cannot be conformance-tested against an envelope parser that has not yet stabilised. The order is: Ring 0 → Ring 1 → Ring 2 (queue then relay then workers) → Ring 3 (proto-only at first, full SDKs in parallel) → Ring 4 (features) interleaved with Ring 6 (UI) → Rings 5, 7, 8, 9 → Ring 10 throughout. Section 12 is canonical reference, not a milestone — consult it whenever you need to know where something runs.

When you encounter a decision the user did not pre-answer — segment size, page size, compaction tier ratios, batch sizes, shard counts, worker counts — measure, do not guess. When you encounter a place where this specification is wrong, say so plainly and propose the correction. When you encounter a place where Sentry’s documented behaviour differs from this specification, defer to Sentry’s documentation; this is a replica, not a reinvention.

The user values end-to-end ownership. Own each Ring start-to-finish — design, code, tests, benchmarks, runbooks. Course-correct when the direction is wrong; never paper over. Production readiness is the standard, not an aspiration.

Build it.