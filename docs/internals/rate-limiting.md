# Rate limiting

Source: [`packages/rate-limit/`](../../packages/rate-limit/).

The relay rate-limits per `(project_id, data_category)` using a **leaky-bucket** algorithm.

## The bucket

Each bucket has:

- `capacity` — max tokens. Drained to zero in a burst.
- `refillPerSecond` — tokens added per second, capped at `capacity`.
- `tokens` — current tokens (float, time-decayed lazily).
- `lastRefillTimestamp` — used to lazily refill on the next check.

On `tryAccept()`:

```
elapsedSeconds = (now - lastRefillTimestamp) / 1000
tokens = min(capacity, tokens + elapsedSeconds * refillPerSecond)
lastRefillTimestamp = now

if tokens >= 1:
  tokens -= 1
  return "accepted"
else:
  return "rate_limited"
```

No background timer, no clock drift, no per-bucket goroutine — pure on-demand math when each item arrives.

## Bucket lifecycle

Buckets are lazily allocated in a per-relay-process `Map<bucketKey, LeakyBucket>` (`bucketKey = "${projectId}:${category}"`). They live in memory; on process restart they reset to full capacity. This is a deliberate trade-off: the spec mentions a Redis mirror for cross-process coordination, but in steady state the per-relay bucket is good enough — with `relayProcs = max(2, cores/8)` per host, each relay sees `1/relayProcs` of traffic, so the effective global rate is `relayProcs × (capacity, refill)`.

## Rule matching

```ts
interface RateLimitRule {
  project: string | "*";
  category: string | "*";
  capacity: number;
  refillPerSecond: number;
}
```

Rules are evaluated in order; the first match wins. Wildcards on either field. Tunable per project in **Project settings → Rate limits**.

## Categories

The category comes from the envelope item type — `error`, `transaction`, `attachment`, `session`, `log`, `replay`, `monitor`, `metric`, `profile`, `feedback`. See [API: rate limits](../api/rate-limits.md#data-categories) for the full mapping.

## Response

Per-item rejection does **not** return HTTP 429 for the whole request. The endpoint returns `200 OK` with the count:

```json
{ "id": "...", "accepted": 2, "rate_limited": 3, "filtered": 0 }
```

The relay records a `rate_limited` outcome for each rejected item, so operators see it in metrics regardless of how the SDK behaves.

A whole-request HTTP 429 is reserved for system-level guards (e.g. global accept-rate cap). When that fires, `Retry-After: <seconds>` is set on the response.

## Where to read next

- [API: rate limits](../api/rate-limits.md) for the user-facing contract.
- [`packages/rate-limit/src/bucket.ts`](../../packages/rate-limit/src/bucket.ts) — the LeakyBucket implementation.
- [`packages/rate-limit/src/limiter.ts`](../../packages/rate-limit/src/limiter.ts) — rule matching.
