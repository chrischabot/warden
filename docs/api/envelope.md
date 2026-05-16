# Envelope ingest

```
POST /api/{project_id}/envelope/
```

The primary ingest endpoint. Every SDK sends to this. Wire-compatible with the Sentry envelope protocol so existing Sentry-compatible tooling works against Warden by changing the DSN host.

Source: [`apps/relay/src/handler.ts`](../../apps/relay/src/handler.ts).

## Request

### Headers

| Header                | Required | Value                                                                              |
| --------------------- | -------- | ---------------------------------------------------------------------------------- |
| `Content-Type`        | Yes      | `application/x-sentry-envelope`                                                    |
| `X-Sentry-Auth`       | Either   | `Sentry sentry_key=<public_key>, sentry_version=7[, sentry_client=<name>/<ver>]` |
| `?sentry_key=...`     | Either   | DSN public key as a query parameter (fallback when headers are inconvenient).      |

The trailing slash is significant on the path: both `/api/{project_id}/envelope/` and `/api/{project_id}/envelope` route the same way, but client conventions vary; use the trailing slash.

### URL parameters

- `project_id` — numeric project identifier, taken from the DSN's path component.

### Body

A newline-delimited envelope:

```
{envelope_header_json}\n
{item_header_json}\n
{item_payload}\n
{item_header_json}\n
{item_payload}\n
...
```

**Envelope header** (one line, JSON object). Useful fields:

| Field        | Type   | Notes                                                                            |
| ------------ | ------ | -------------------------------------------------------------------------------- |
| `event_id`   | string | 32-char lowercase hex. Required for `event` and `transaction` envelopes.        |
| `sent_at`    | string | ISO 8601 timestamp at the SDK's clock when the envelope was queued.              |
| `sdk`        | object | `{name, version}`.                                                              |
| `dsn`        | string | Optional. The DSN the SDK was configured with.                                  |
| `trace`      | object | Optional. Trace context for dynamic sampling: `{trace_id, public_key, ...}`.    |

**Item header** (one line per item, JSON object). Always carries:

| Field            | Type    | Notes                                                                                |
| ---------------- | ------- | ------------------------------------------------------------------------------------ |
| `type`           | string  | One of the item types below.                                                          |
| `length`         | number  | Byte length of the item payload that follows. Required for binary items.              |
| `content_type`   | string  | Optional. Defaults to `application/json` for JSON items.                              |
| `filename`       | string  | For `attachment` items.                                                              |
| `attachment_type` | string | For `attachment` items: `event.minidump`, `event.attachment`, `event.applecrashreport`, `unreal.context`, etc. |

**Item payload** — JSON for most types, or binary for `attachment` items. The payload is the next `length` bytes after the item header newline (if `length` is given), or up to the next newline.

### Item types

| Type             | Payload                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `event`          | Error / message event JSON. See [Concepts: Event](../concepts.md#event).                      |
| `transaction`    | Transaction JSON with `type: "transaction"`, `start_timestamp`, `timestamp`, `spans[]`.        |
| `session`        | Session start/end record for release health.                                                  |
| `sessions`       | Bulk session aggregates.                                                                       |
| `log`            | Sentry-native log line.                                                                        |
| `otel_log`       | OTLP-shaped log record (forwarded by an SDK using OTLP).                                       |
| `otel_span`      | OTLP-shaped span record.                                                                       |
| `user_report`    | End-user feedback attached to an event.                                                       |
| `feedback`       | Standalone user feedback.                                                                     |
| `replay_event`   | Session-replay metadata.                                                                       |
| `check_in`       | Cron heartbeat: `{check_in_id, monitor_slug, status, duration}`.                              |
| `statsd`         | StatsD-format custom metrics payload.                                                          |
| `client_report`  | SDK-side outcome report (events the SDK dropped before sending).                              |
| `attachment`     | Binary attachment (minidump, screenshot, view hierarchy, etc.).                                |

## Response

### 200 OK

The relay accepted the request (some or all items may have been dropped — see the body).

```json
{
  "id": "<event_id or null>",
  "accepted": 2,
  "rate_limited": 1,
  "filtered": 0
}
```

| Field          | Type             | Meaning                                                          |
| -------------- | ---------------- | ---------------------------------------------------------------- |
| `id`           | string \| null   | The event_id from the envelope header, echoed back.              |
| `accepted`     | number           | Items enqueued for ingest.                                       |
| `rate_limited` | number           | Items dropped because the project hit a rate limit.              |
| `filtered`     | number           | Items dropped by dynamic sampling.                               |

`200` is returned even if everything was dropped; check the counts.

### 400 Bad Request

Malformed envelope: bad JSON in header, missing newline separators, invalid UTF-8, length mismatch on a binary item. Body is a JSON `{error}` object.

### 401 Unauthorized

Missing or invalid `X-Sentry-Auth` / `sentry_key`, or DSN public key does not belong to the project in the URL.

### 404 Not Found

Path does not match `/api/{project_id}/envelope/`, or `project_id` does not exist.

### 405 Method Not Allowed

Non-POST method.

### 413 Payload Too Large

Body exceeded the relay's `maxRequestBodySize` (default 100 MiB).

### 429 Too Many Requests

The whole request was rejected by the global rate limit (rare — per-item limits return 200 with `rate_limited` count instead). `Retry-After: <seconds>` header is set.

## Behavior

The relay streams the envelope body and processes items one by one (so 100 MiB minidumps never land in memory whole). For each item:

1. **Authenticate** — check the DSN public key against `project_id`. Reject the whole request on mismatch.
2. **Rate-limit** — per `(project_id, data_category)` leaky bucket. See [Rate limits](./rate-limits.md).
3. **PII scrub** — apply built-in patterns (email, phone, SSN, JWT, bearer tokens, AWS / GCP / Azure secrets) and the project's custom regex denylist to every JSON item. Attachment bodies are not scrubbed.
4. **Dynamic sample** — deterministic decision on `trace_id` (fall back to a hash of event fields if absent). See [Internals: sampling](../internals/sampling.md).
5. **Enqueue** — append to queue topic `{project_id}:{item_type}`.
6. **Record outcome** — accepted / rate_limited / filtered / invalid. See [Outcomes](./outcomes.md).

Outcomes are recorded for every item, including drops, so operators can see why traffic isn't landing.

## Request size limits

| Limit                       | Value                                              |
| --------------------------- | -------------------------------------------------- |
| Total request body          | 100 MiB                                            |
| Per-item attachment         | 100 MiB minus envelope overhead                    |
| Envelope header             | 64 KiB                                             |
| Item header                 | 16 KiB                                             |
| Idle timeout                | 30 s (no bytes received from the client)           |

## Example

A minimal error event envelope:

```
{"event_id":"fc6d8c0c43fc4630ad850ee518f1b9d0","sent_at":"2026-05-16T12:34:56.789Z","sdk":{"name":"sentry-replica.javascript","version":"0.0.0"}}
{"type":"event","length":234}
{"event_id":"fc6d8c0c43fc4630ad850ee518f1b9d0","timestamp":"2026-05-16T12:34:56.789Z","platform":"javascript","level":"error","message":"hello warden","sdk":{"name":"sentry-replica.javascript","version":"0.0.0"}}
```

POST that, with `Content-Type: application/x-sentry-envelope` and `X-Sentry-Auth: Sentry sentry_key=localpub, sentry_version=7`, to `http://localhost:9000/api/1/envelope/`.

## Where to read next

- [Rate limits](./rate-limits.md)
- [Outcomes](./outcomes.md)
- [Reporting guide](../reporting-guide.md) — how to use this endpoint correctly via an SDK.
