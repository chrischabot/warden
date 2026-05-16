# Internals

How Warden is built. This is the developer side of the docs.

If you're operating Warden, the [Operations](../operations/) section is enough. If you're modifying it — implementing a feature, fixing a bug, profiling a regression — read this directory.

## Map

- **[Columnar event store](./columnar-store.md)** — encodings, segment format, MemTable, WAL, zone-maps, query, compaction.
- **[Queue](./queue.md)** — segmented append-only log, group-commit fsync, crash recovery.
- **[Grouping](./grouping.md)** — the fingerprint algorithm and group-hash function.
- **[Sampling](./sampling.md)** — deterministic rule-based dynamic sampling on `trace_id`.
- **[PII scrubbing](./pii-scrubbing.md)** — built-in patterns, custom regex, attachment policy.
- **[Rate limiting](./rate-limiting.md)** — leaky-bucket per `(project, data_category)`.
- **[Auth](./auth.md)** — DSN authenticator, token authenticator, scope-check.
- **[Package reference](./packages.md)** — every internal package and what it does.

## High-level layout

```
warden/
├── apps/
│   ├── relay/                # HTTP envelope ingest
│   ├── ingest/               # queue consumer → grouping → store
│   └── web/                  # React UI
├── packages/                 # 29 internal packages, see ./packages.md
├── sdks/                     # 5 SDKs
├── specs/                    # source-of-truth spec + corrections
└── e2e/                      # end-to-end + load tests
```

Every workspace package is `@sr/<name>` (e.g. `@sr/columnar`, `@sr/queue-core`, `@sr/topology`). Apps depend on packages; SDKs don't depend on anything outside `sdks/` so they can be vendored independently.

## Type-checking and runtime

Bun runs TypeScript directly. We don't emit `.js` or `.d.ts`. CI gates type-checking with `tsgo --noEmit` (the TypeScript 7 native preview). Lint and format with Biome v2. Test with `bun test --parallel --isolate`.

`bun run validate` runs lint + typecheck + tests.

## Effect v4

Hot paths use Effect v4 (beta) for structured concurrency, error handling, and cancellation. Imports are from `effect` (not `effect-smol`; see [`specs/SPEC-CORRECTIONS.md` §2](../../specs/SPEC-CORRECTIONS.md)).

## No external services

Warden has no Postgres, no Redis, no Kafka, no S3 in the hot path. Metadata is `bun:sqlite` with WAL mode, sharded by `(org_id, project_id)`. Queue state is segment files on local disk. Columnar state is segment files on local disk. The only thing outside the platform is the supervisor (systemd, k8s) that spawns Warden processes.

## Tests

Workspace-wide: ~1,036 Bun tests across packages and apps.

Per-language SDK suites:

- Python: 56 tests (`pytest -q`)
- Rust: 34 tests (`cargo test`)
- Go: 37 tests (`go test ./...`)
- Swift: 40 tests (`swift test`)

End-to-end: 33 scenarios (20 envelope scenarios, 10 envelope-type coverage, coverage check, 20k-event load burst) in `e2e/`.

UI journeys: 18 Playwright + Chromium scenarios covering the 14 main routes, ~188 interactions, asserted zero console errors.

## Where to read next

- [Package reference](./packages.md) — pick any package and the doc tells you where to read in source.
