# Sampling

Source: [`packages/sampling/`](../../packages/sampling/).

Dynamic sampling decides, per envelope item, whether to keep it or drop it (recording a `filtered` outcome). The goal is to keep representative traffic without paying for every event from a high-volume customer.

## Algorithm

```
decision = hash64(trace_id) / 2^64 < sample_rate ? "keep" : "drop"
```

The sampler walks rules in order. The first matching rule's `sampleRate` is used. If no rule matches, the default rate applies.

When `trace_id` is absent (errors without a trace, message events), the sampler falls back to hashing the concatenation of `(event_id, project_id, environment)` — still deterministic, just per-event instead of per-trace.

## Why deterministic on `trace_id`

If two events share a trace, you want both kept or both dropped — otherwise the trace is incomplete. Hashing the trace ID and comparing to `sample_rate` guarantees that.

It also means decisions are stable across relay restarts and across relay replicas (no per-instance seed), so you can change the rule set without re-rolling decisions for in-flight traces.

## Rules

```ts
interface SamplingRule {
  match: {
    project?: string;
    environment?: string;
    "tag.<name>"?: string | { in: string[] };
    "op"?: string;            // for transactions
    // ...
  };
  sampleRate: number;          // 0.0 .. 1.0
}
```

Rules are stored per project and merged with org-level rules. Rule order matters; first match wins.

Typical rule set for a busy API:

```jsonc
[
  { "match": { "environment": "production", "op": "http.server", "tag.route": "/health" }, "sampleRate": 0.0 },
  { "match": { "environment": "production", "tag.user_tier": "enterprise" },              "sampleRate": 1.0 },
  { "match": { "environment": "production", "op": "http.server" },                        "sampleRate": 0.1 },
  { "match": { "environment": "production" },                                              "sampleRate": 0.05 }
]
```

Default rate (no match) is set per project in **Project settings → Dynamic sampling**. The hard floor — events at level `error` or `fatal` — is always kept regardless of sampling.

## Where it runs

The relay applies sampling *after* PII scrubbing and *before* enqueuing. Dropped items record a `filtered` outcome (see [API: outcomes](../api/outcomes.md)).

The SDK can also sample client-side via `traces_sample_rate` — but the SDK-side sampler is not yet exposed in any of the five SDKs. Currently all sampling happens server-side at the relay.

## Hard rules

- Errors with `level: fatal` are never dropped.
- Crash-rate-relevant `session` items are never dropped.
- `check_in` items for crons are never dropped (you want to know about missed runs).
- `client_report` items (the SDK's own outcome reports) are never dropped.

## Where to read next

- [`packages/sampling/src/sampler.ts`](../../packages/sampling/src/sampler.ts).
- [API: outcomes](../api/outcomes.md).
