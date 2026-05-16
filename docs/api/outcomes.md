# Outcomes

For every envelope item the relay receives, it records exactly one **outcome**. Outcomes are how operators see why traffic isn't landing.

Source: [`packages/outcomes`](../../packages/outcomes/).

## Categories

```
'accepted' | 'rate_limited' | 'invalid' | 'filtered' |
'over_quota' | 'abuse' | 'client_discard' | 'network_error'
```

| Outcome           | When                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `accepted`        | Enqueued to the ingest queue. This is the "success" terminal state in the relay.                                     |
| `rate_limited`    | Dropped by the per-(project, category) leaky bucket. See [Rate limits](./rate-limits.md).                            |
| `invalid`         | Failed validation: bad JSON, missing required field, malformed envelope item, schema mismatch.                       |
| `filtered`        | Dropped by dynamic sampling. See [Internals: sampling](../internals/sampling.md).                                    |
| `over_quota`      | Project's monthly quota exhausted. Distinct from `rate_limited` (which is short-term burst).                          |
| `abuse`           | Dropped by abuse heuristics (suspicious origin, malformed bursts).                                                   |
| `client_discard`  | SDK reported that it discarded the item before sending. Sourced from `client_report` items, not the relay.            |
| `network_error`   | SDK reported that a previous send failed with a network error. Sourced from `client_report` items.                   |

## Where outcomes appear

1. **Prometheus metrics** — `sr_relay_envelopes_total{project, outcome}` and `sr_relay_envelope_bytes_total{project}`. Use this for live dashboards and alerting.
2. **Project settings → Outcomes** in the web UI — charts per project per outcome over time.
3. **Discover** — outcomes are emitted as their own data stream; you can query them like any other event source.

## Why outcomes matter

Without them, dropped traffic is invisible. With them you can:

- See your SDK upgrade roll out (`client_discard` should drop as users move to a saner SDK version).
- Catch a misconfigured DSN (a sudden spike of `invalid` from one project).
- Decide whether to raise a project's rate limit (rate_limited rising during peak hours).
- Detect quota exhaustion before users complain.

## SDK side: client reports

Each SDK can produce `client_report` envelope items that tell the platform what the SDK itself dropped before it ever sent. The protocol is:

```
{ "type": "client_report", "length": N }
{ "timestamp": "...", "discarded_events": [{ "reason": "queue_full", "category": "error", "quantity": 7 }, ...] }
```

Reasons the SDKs may emit:

- `queue_full` — local buffer overflowed.
- `cache_overflow` — disk cache for offline buffering full.
- `ratelimit_backoff` — SDK respected a previous 429's `Retry-After`.
- `network_error` — fetch failed.
- `sample_rate` — SDK-side `traces_sample_rate` rejected the item.

The relay forwards these to the same outcome stream, tagged with the matching outcome name.

## Where to read next

- [Rate limits](./rate-limits.md).
- [Internals: sampling](../internals/sampling.md).
