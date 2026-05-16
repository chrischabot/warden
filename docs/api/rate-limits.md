# Rate limits

The relay rate-limits per `(project_id, data_category)` using a leaky-bucket algorithm. Source: [`packages/rate-limit`](../../packages/rate-limit/).

## Algorithm

For each `(project_id, data_category)`:

- A bucket has a **capacity** (max burst) and a **refill rate** (tokens per second).
- On each item, decrement by one. If the bucket goes below zero, the item is rejected.
- The bucket refills continuously at the refill rate, capped at capacity.

Defaults (per spec; tunable per project in **Project settings → Rate limits**):

| Bucket               | Capacity | Refill rate (per second) |
| -------------------- | -------- | ------------------------ |
| Default              | 100      | 10                       |

Buckets are lazily allocated and held in process memory by the relay. Across multiple relay processes, the buckets are not currently shared; under the spec they will mirror to Redis or a leader process. In practice, with `relayProcs = max(2, cores/8)` relays per host and `SO_REUSEPORT`, the bucket per relay tracks `1/relayProcs` of total traffic — divide refill by `relayProcs` if you need a sharp global cap.

## Data categories

The category is derived from the envelope item type:

| Item type                            | Category                |
| ------------------------------------ | ----------------------- |
| `event`                              | `error`                 |
| `transaction`                        | `transaction`           |
| `attachment`                         | `attachment`            |
| `session`, `sessions`                | `session`               |
| `log`, `otel_log`                    | `log`                   |
| `replay_event`                       | `replay`                |
| `check_in`                           | `monitor`               |
| `statsd`                             | `metric`                |
| `profile`, `profile_chunk`           | `profile`               |
| `user_report`, `feedback`            | `feedback`              |

Limits configured per category per project. The default rule matches all categories; you can override per category (e.g. cap `attachment` separately from `error`).

## Rules

Rule format (per [`packages/rate-limit/src/limiter.ts`](../../packages/rate-limit/src/limiter.ts)):

```ts
type RateLimitRule = {
  project: string | "*";       // project id or "*"
  category: string | "*";      // data category or "*"
  capacity: number;            // burst max
  refillPerSecond: number;     // refill rate
};
```

Rules are matched in order; the first match wins. Configure them in **Project settings → Rate limits** in the UI, or via the admin API.

## Responses

Per-item rejection does **not** return 429 for the whole request. The endpoint returns `200 OK` with the `rate_limited` count in the body:

```json
{ "id": "...", "accepted": 2, "rate_limited": 3, "filtered": 0 }
```

A **whole-request** 429 is returned only when:

- The project is globally suspended (admin action), or
- A global capacity guard (1k rps default per relay) fires due to system overload.

When a 429 is returned, the response includes:

```
Retry-After: <seconds>
```

The client should pause sending for that many seconds, then resume.

## SDK behavior

All five SDKs are fire-and-forget — they do not by default retry rate-limited items, because the relay reports the rate-limit in the response body (not via an error). The recommended pattern in your application is to use `Client.flush(timeoutMs)` on shutdown to drain pending sends, and accept the rate-limit count as visibility (recorded as outcomes in the platform).

If you need true client-side adherence to the rate-limit advice, layer a custom transport around the SDK transport that respects the body counts and 429 headers.

## Where to read next

- [Outcomes](./outcomes.md) — `rate_limited` is recorded as an outcome for every dropped item, so operators can see and chart the drop rate per project.
- [Internals: rate limiting](../internals/rate-limiting.md) — the leaky-bucket implementation.
