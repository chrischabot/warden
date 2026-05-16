# @sr/e2e — End-to-end test suite

Drives the full sentry-replica pipeline (SDK → relay handler → queue → ingest worker → grouping → store fan-out) with realistic events, then measures throughput, memory, event-loop lag, and accuracy under load.

## What it exercises

### 20 use-case scenarios (`src/scenarios.ts`, `test/scenarios.test.ts`)

The 20 most common observability situations a Sentry replica must handle correctly. Each scenario:

1. **Constructs a realistic source event** (Error subclass with a real stack, transaction with spans, log line, metric sample, …).
2. **Routes it through the full pipeline** — SDK → in-process transport → relay → queue → ingest drain → store.
3. **Asserts side effects** — fingerprint matches, group state transition correct, store contents accurate.

| # | Scenario | What it proves |
|--:|----------|----------------|
| 1 | null-pointer TypeError | JS `cannot read properties of undefined` → fingerprint stable, group created, level=error |
| 2 | ReferenceError | identifier not defined → distinct group from #1 |
| 3 | network failure (ECONNREFUSED) | Outbound network failure classified by Seer heuristic |
| 4 | HTTP 500 | captured server error, status tag preserved |
| 5 | DB connection pool exhausted | distinct group, SQL keyword path in Seer |
| 6 | slow DB query (>500ms) | performance detector emits slow-query issue |
| 7 | N+1 query loop | performance detector emits n-plus-one issue with `count=5` |
| 8 | memory warning (level=warning) | level rises within group on second sighting |
| 9 | cron missed tick | MonitorStore.evaluate flips status `ok → missed` |
| 10 | cron timeout | open run > maxRuntimeMs → `timeout` |
| 11 | uptime DOWN with incident | 3 consecutive `down` results open an Incident |
| 12 | rate-limit triggered | LeakyBucket rejects beyond capacity |
| 13 | PII scrubbing (email, CC, SSN) | message redacted before enqueue |
| 14 | trace propagation (sentry-trace + baggage) | traceId / spanId / sampled / DSC propagate |
| 15 | release deploy | ReleaseStore records release + deploy |
| 16 | issue regression on resolve | resolve → new event → status=unresolved + hasRegressed |
| 17 | snooze auto-reopen (untilEvents) | ignored group auto-reopens at threshold |
| 18 | bulk archive | bulk operation archives matched groups |
| 19 | custom counter metric | sum aggregates within bucket, distinct tag sets split |
| 20 | OTLP trace ingest | OTLP/JSON span batch → Sentry Transaction with child spans |

### 10 envelope item types (`src/envelope-types.ts`, `test/envelope-types.test.ts`)

Per spec §3.2 — the 10 Sentry envelope item types the relay must accept and route:

| # | Type | Routed into |
|--:|------|-------------|
| 1 | `event` | IssueStore (via fingerprint) |
| 2 | `transaction` | TransactionStore |
| 3 | `log` | LogStore |
| 4 | `statsd` (custom metric) | MetricStore |
| 5 | `session` | session counter |
| 6 | `attachment` | binary store (just acked here) |
| 7 | `profile` | ProfileStore |
| 8 | `replay_recording` | ReplayStore segments |
| 9 | `check_in` | MonitorStore |
| 10 | `user_report` | feedback table |

### Load test (`test/load.test.ts`, `src/load.ts`)

A 20,000+ event burst that drives the pipeline at saturation and produces a structured report covering:

- **Throughput** (events / sec)
- **Memory** (RSS + heap before/after, peak deltas)
- **Pressure** (event-loop lag p50 / p95 / p99 sampled every 10 ms during the burst)
- **Scaling** (per-shard counters when relevant)
- **Accuracy** (events_sent === events_routed; unique-fingerprint count matches; no group/transaction dropped)

## Run

```bash
bun test e2e/                  # 20 scenarios + 10 envelope types + load test
bun run --filter=@sr/e2e load  # standalone load runner (prints the report)
```