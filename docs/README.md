# Warden documentation

Warden is an observability platform — errors, traces, profiles, replays, crons, uptime, releases, logs, and metrics — built on Bun with a custom columnar event store, a custom append-only queue, and a custom HTTP relay. This directory holds the end-user and developer documentation.

If you're new, start with [Getting started](./getting-started.md). If you're integrating an application, read the [SDK reference](./sdks/README.md) for your language and the [reporting guide](./reporting-guide.md). If you're running Warden as a service, read [Operations](./operations/). If you're working on Warden itself, read [Internals](./internals/) and [Contributing](./contributing.md).

## Map

### Start here

- **[Getting started](./getting-started.md)** — install Bun, clone, run the relay, send your first event from each SDK in 10 minutes.
- **[Platform overview](./platform-overview.md)** — what Warden captures, the product surface, and how it's different from other observability stacks.
- **[Concepts](./concepts.md)** — DSN, envelope, event, transaction, scope, hub, issue, group, fingerprint, release, outcome.
- **[Architecture](./architecture.md)** — processes, data flow, topology-driven scaling, how Warden uses every core of a multi-core box.

### Operations

- **[Installation](./operations/installation.md)** — system requirements, Bun setup, workspace install, validation.
- **[Deployment](./operations/deployment.md)** — running the relay, ingest workers, and web UI in production. Systemd / supervisord templates, reverse-proxy notes, port and TLS.
- **[Scaling and topology](./operations/scaling-and-topology.md)** — every sizing formula, what scales linearly with cores, what doesn't, and how to pick a host.
- **[Storage and data](./operations/storage-and-data.md)** — data directory layout, columnar segments, queue segments, SQLite metadata shards, retention, backup, and restore.
- **[Observability](./operations/observability.md)** — health probes, Prometheus metrics, self-metrics namespace, what to alert on.

### HTTP API reference

- **[API overview](./api/README.md)** — base URLs, auth models, content types, status codes.
- **[Envelope ingest](./api/envelope.md)** — `POST /api/{project_id}/envelope/` complete reference, every item type, every status code.
- **[OTLP](./api/otlp.md)** — OpenTelemetry traces and logs over OTLP/JSON.
- **[Rate limits](./api/rate-limits.md)** — algorithm, scopes, response shape on 429.
- **[Outcomes](./api/outcomes.md)** — what `accepted`, `rate_limited`, `filtered`, `invalid` actually mean.

### SDKs

- **[SDK overview](./sdks/README.md)** — what's in each SDK, language parity matrix.
- **[JavaScript / TypeScript](./sdks/javascript.md)** — full reference: every function, parameter, and type.
- **[Python](./sdks/python.md)** — full reference.
- **[Rust](./sdks/rust.md)** — full reference.
- **[Go](./sdks/go.md)** — full reference.
- **[Swift](./sdks/swift.md)** — full reference.

### Reporting guide

- **[Reporting guide](./reporting-guide.md)** — how to correctly instrument an application: errors, messages, context, user identity, scopes, fingerprinting, releases, source maps, PII.

### Web dashboard

- **[Web dashboard](./web-dashboard.md)** — full guide to the UI: layout, every page, navigation, search, command palette, keyboard shortcuts, settings, SDK setup wizard.

### Internals

- **[Internals overview](./internals/README.md)** — how the platform is built.
- **[Columnar event store](./internals/columnar-store.md)** — encodings, segment format, MemTable, WAL, zone-maps, query, compaction.
- **[Queue](./internals/queue.md)** — segmented append-only log, group-commit, recovery.
- **[Grouping](./internals/grouping.md)** — fingerprint algorithm and group hash.
- **[Sampling](./internals/sampling.md)** — deterministic rule-based dynamic sampling.
- **[PII scrubbing](./internals/pii-scrubbing.md)** — patterns, denylist, attachment policy.
- **[Rate limiting](./internals/rate-limiting.md)** — leaky-bucket per `(project, data_category)`.
- **[Auth](./internals/auth.md)** — DSN authentication, API tokens, scopes.
- **[Package reference](./internals/packages.md)** — every internal package and its purpose.

### Contributing

- **[Contributing](./contributing.md)** — dev workflow, `bun run validate`, biome, tsgo, test sharding, conventions.

## Spec

The full source-of-truth specification lives in [`../specs/SPEC.md`](../specs/SPEC.md), with corrections in [`../specs/SPEC-CORRECTIONS.md`](../specs/SPEC-CORRECTIONS.md). The docs in this directory are written for users and developers; the spec is what the implementation is measured against.

## Implementation status notes

Some surfaces described in the SDK references and API reference are **implemented and shipping**; others are **defined in the spec and the codebase carries the building blocks** but the public HTTP wiring is not yet live. Each doc calls this out explicitly where it matters. As of writing: the envelope ingest path, all five SDKs' capture surface, and the columnar store are live; OTLP/JSON converters exist but their HTTP routes are not yet wired in the relay; the web UI renders 14 routes against mock data while the read-side API is in progress.
