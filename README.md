# Warden

Warden is a from-scratch reimplementation of Sentry's backend in TypeScript on Bun. An error tracker at this level normally leans on a message broker to absorb incoming events and an analytical database to answer questions about them, so running one means running those systems as well. Warden's design replaces both with code in this repository, a durable segmented log and a custom columnar event store on local disk, and adds a relay that speaks Sentry's envelope protocol, a fingerprinting engine that groups errors into issues, and SDKs for five languages.

Chris Chabot specified it for the five services behind iGent AI's agent platform, and Maestro, iGent's autonomous coding agent, built it under three constraints: Bun as the runtime, 10,000 events per second sustained, and no external project handling any architectural piece, which rules out Kafka, ClickHouse and DuckDB among others. The repository is most useful today to engineers who want to see how an observability backend fits together, or who want a starting point for a relay, a durable log or a columnar store on Bun.

It isn't something you can deploy yet. The components exist as libraries with their own tests, but the process that would connect them hasn't been written, so the relay and ingest entry points stop at startup asking for the queue and storage sink it should supply, and the web UI runs on mock data. An in-process harness is how you see the pieces work together, and [Run the pipeline](#run-the-pipeline) shows how to use it.

## How it works

An SDK captures an error, wraps it in a Sentry envelope and posts it to the relay. For each item in the envelope the relay applies per-project rate limits, samples deterministically on the trace ID and scrubs personal data and secrets from JSON payloads, then appends what survives to a queue topic named `<project_id>:<item_type>`. An ingest worker reads those records, fingerprints each event from its in-app stack frames so that repeats of one failure collapse into a single issue, and hands the result to a storage sink.

Each stage takes its neighbours as injected dependencies, which is why the same relay handler can run inside a test or behind `Bun.serve`. The harness injects an in-memory queue and uses its own `drain()` step in place of the ingest worker to route items into in-memory product stores. The durable segmented log and the columnar store are implemented and tested on their own, and connecting them to this path, then putting a read API in front of the data, is the work that remains.

## Install

Warden needs Bun 1.3.14 or newer on macOS or Linux, or on Windows through WSL2.

```bash
git clone https://github.com/chrischabot/warden.git
cd warden
bun install --frozen-lockfile
```

## Run the pipeline

The harness in [`e2e/`](e2e/README.md) runs the real JavaScript SDK and relay handler in a single process, with no sockets or disk involved.

```bash
bun test e2e/        # 20 scenarios, 10 envelope item types and a load test
bun e2e/src/load.ts  # a 20,000-event burst, reporting throughput, memory, event-loop lag and accuracy
```

You can also drive it directly. Save this as `demo.ts` in the repository root and run `bun demo.ts`:

```ts
import { Pipeline } from './e2e/src/pipeline';

const pipeline = new Pipeline({ enablePiiScrub: true });
const client = pipeline.sdkClient('1', { release: 'demo@1.0.0' });

for (let i = 0; i < 3; i++) {
  client.captureException(new TypeError('Could not notify alice@example.com'));
}
await client.flush();
pipeline.drain();

for (const group of pipeline.issues.all()) {
  console.log(group.message, group.status, group.timesSeen);
}
// Could not notify [Filtered] unresolved 3
```

The three captures become one issue, and the relay removed the address before the payload reached the queue.

The project's [plan](plan.md#11-performance-optimization-landing-2026-05-16) records a median of about 20,000 events per second for the load test on a 2 vCPU sandbox, up from about 7,500 before an optimisation pass. That run covers the SDK, relay handler and in-memory stores with rate limiting, sampling and scrubbing switched off, so it tells you how fast that code path is rather than what a deployment would sustain.

To go beyond the harness you have to write the missing orchestrator: give `startRelay` in `apps/relay` a `RelayQueue` backed by `SegmentedLog`, and give `runWorker` in `apps/ingest` a source over that log and an `IngestSink` that writes to storage.

## Web UI

```bash
cd apps/web
bun run dev   # http://localhost:8080
```

The React app is a clickable prototype of the intended product, with 18 routes covering issues, traces, performance, profiles, Discover, dashboards, alerts, crons, uptime, releases, source maps and settings. Everything it shows comes from a mock data layer, so events sent to a relay won't appear there, and bulk actions on issues confirm with a toast without changing anything.

## SDKs

| Language | Path | Name in its manifest |
| --- | --- | --- |
| TypeScript and JavaScript | `sdks/javascript` | `@sr/sdk-javascript` |
| Python | `sdks/python` | `sentry-replica`, imported as `sentry_replica` |
| Rust | `sdks/rust` | `sentry-replica-core` |
| Go | `sdks/go` | `github.com/igentai/sentry-replica/sdks/go` |
| Swift | `sdks/swift` | `SentryReplica` |

Each SDK parses DSNs of the form `https://<public_key>@<host>/<project_id>`, builds Sentry envelopes and offers capture and scope calls modelled on Sentry's. They still carry the project's working name, and these manifest names are the ones to use, whatever some of the guides call them. You use them from a checkout of this repository, and the [SDK references](docs/sdks/README.md) cover each language.

## Under the hood

**Relay** (`apps/relay`). `createRelay` returns a fetch handler for `POST /api/{project_id}/envelope/` that responds with `{ id, accepted, rate_limited, filtered }`. It reads the whole body into one buffer and parses it synchronously, because profiling showed that the earlier streaming parser accumulated the body anyway while taking about a quarter of the relay's time. `startRelay` serves the handler with a 100 MiB body limit and `reusePort`, so several relay processes can share a port. DSN keys aren't checked at this layer yet. The [envelope reference](docs/api/envelope.md) covers the wire format.

**Queue** (`packages/queue-core`). `SegmentedLog` is an append-only log across rolling segment files. Appends are batched and written together with `writev` and `fdatasync`, by default every 10 ms or 1 MiB, and an append's promise resolves once its batch is on disk. Segments roll at 256 MiB or after an hour. Reads validate a CRC32 on every record, consumers address records by logical offset, and reopening a log truncates any partial record a crash left at the end of the active segment.

**Columnar store** (`packages/columnar`). Columns are divided into pages, and each page is encoded raw, as a string dictionary with bit-packed IDs, as run lengths for `int32` runs, or as delta plus frame-of-reference for near-monotone `int32` columns. Numeric pages carry min/max zone maps, which lets `query()` skip pages without decoding them, and the rest of the query runs as generator operators that pass column batches from scan through filter, project and limit. The package also holds the MemTable, a CRC-checked write-ahead log and `compactSegments`, which merges sealed segments and re-encodes them.

**Grouping** (`packages/grouping`). `fingerprintEvent` prefers an explicit fingerprint, then the module and function of up to five in-app frames, then the exception type and value, then the message. File names and line numbers stay out of the hash, so an issue keeps its identity when a rebuild moves code around.

**Product logic** (`packages/`). The issue state machine with regressions and snoozes, N+1 and slow-query detection, alert evaluators, cron and uptime state, release tracking, and replay, profile, log and custom metric stores all live here as libraries that hold their state in memory. The same directory holds the OTLP/JSON converters, JavaScript source map symbolication, the DSN and API token authenticators and the SQLite shard router, which no HTTP route calls yet.

**Topology** (`packages/topology`). `computeTopology({ cores })` derives the count of every process kind from the host's core count, from about 24 processes on 4 cores to about 171 on 64. It is the sizing plan for a deployment, and nothing spawns those processes yet.

## Development

The workspace has three apps in `apps/`, 29 internal packages under the `@sr/` scope in `packages/`, five SDKs in `sdks/` and the harness in `e2e/`. Bun runs the TypeScript directly, `tsgo` from the TypeScript 7 native preview does the type-checking, and Biome handles lint and formatting. The web UI uses React 19.2, Tailwind 4.3, React Router 7 and Vite 6.

```bash
bun run lint       # biome check .
bun run typecheck  # tsgo --noEmit
bun run test       # bun test --parallel --isolate
bun run validate   # all three, stopping at the first failure
```

CI runs the same checks with the tests split across four shards. On the current `main`, the Biome and `tsgo` jobs and one test shard fail, so expect `bun run validate` to stop at lint until those are fixed.

The other SDKs have their own test commands:

```bash
(cd sdks/python && pip install -e ".[dev]" && pytest)
(cd sdks/rust && cargo test)
(cd sdks/go && go test ./...)
(cd sdks/swift && swift test)
```

The 18 Playwright journeys for the web UI run against the dev server, as described in [`apps/web/test-e2e`](apps/web/test-e2e/README.md).

## Documentation

[`docs/`](docs/README.md) holds the architecture overview, operations guides, API and SDK references, and notes on [the columnar store](docs/internals/columnar-store.md), [the queue](docs/internals/queue.md) and the other internals. [`specs/SPEC.md`](specs/SPEC.md) is the original specification, with [`specs/SPEC-CORRECTIONS.md`](specs/SPEC-CORRECTIONS.md) alongside it, and [`plan.md`](plan.md) is the construction log. These documents describe the whole intended system, so treat the relay and ingest start commands in the getting-started and deployment guides as the intended design until an orchestrator exists.

## License and credits

Warden is released under the [MIT License](LICENSE), copyright 2026 Chris Chabot, who wrote the specification and directed the build. Maestro, iGent AI's autonomous coding agent, wrote the implementation.

Warden implements Sentry's envelope protocol and follows its product model, but it is an independent project and isn't affiliated with Sentry. The specification also credits C-Store, X100, ORC, Pinot, ClickHouse MergeTree, Druid and QuestDB for the storage ideas it borrows.
