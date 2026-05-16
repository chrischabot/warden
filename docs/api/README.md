# HTTP API

Warden exposes three HTTP surfaces:

1. **Envelope ingest** — `POST /api/{project_id}/envelope/` on the relay. Live. The way SDKs send data to Warden.
2. **OTLP** — `POST /api/{project_id}/integration/otlp/v1/{traces,logs}/` on the relay. Converters live; HTTP wiring in progress.
3. **Read-side API** — `GET /api/{org}/projects/{project}/...` on the API process. In progress; will power the web UI and external API consumers.

This directory documents each in detail.

## Base URL

Whatever the host of the DSN is. For SDK uploads, the SDK derives the envelope URL from the DSN automatically. For direct HTTP usage:

```
<dsn-scheme>://<dsn-host>[:<dsn-port>][/<dsn-path>]/api/{project_id}/envelope/
```

For example, with DSN `https://abc123@warden.example.com/1`, the envelope URL is `https://warden.example.com/api/1/envelope/`.

## Authentication

| Endpoint                     | Auth                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Envelope ingest              | DSN public key, in `X-Sentry-Auth` header or `sentry_key` query parameter.           |
| OTLP                         | DSN public key (planned).                                                            |
| Read API                     | Bearer token in `Authorization: Bearer <token>`.                                     |
| Internal health/metrics      | None (bind to a private interface).                                                  |

DSN format and parsing rules: see [Concepts: DSN](../concepts.md#dsn).

## Content types

| Endpoint            | Request                              | Response             |
| ------------------- | ------------------------------------ | -------------------- |
| Envelope ingest     | `application/x-sentry-envelope`      | `application/json`   |
| OTLP traces / logs  | `application/json`                   | `application/json`   |
| Read API            | n/a (GET) or `application/json`      | `application/json`   |

## Status codes

| Code | Meaning                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| 200  | Accepted (possibly partial — count fields in body tell you what was dropped).                 |
| 400  | Malformed envelope, bad JSON, missing required fields.                                        |
| 401  | Missing or invalid DSN / token.                                                               |
| 403  | Authenticated but not authorized for this project / scope.                                    |
| 404  | Unknown path, unknown project, or unknown resource.                                           |
| 405  | Wrong method for this path.                                                                   |
| 413  | Body exceeded `maxRequestBodySize` (100 MiB for the relay).                                    |
| 429  | Rate-limited. `Retry-After` header indicates how long to back off (seconds).                  |
| 500  | Internal error. Treat as transient and retry with backoff.                                    |

## CORS

The relay returns permissive CORS headers so browser-based SDKs can POST envelopes from any origin. If you front the relay with a proxy, ensure the proxy passes `Access-Control-Allow-Origin: *` (or your origin allowlist) through. The read API uses origin-restricted CORS configured by your deployment.

## Where to read next

- [Envelope ingest](./envelope.md) — complete reference for the live endpoint.
- [OTLP](./otlp.md) — OpenTelemetry traces and logs.
- [Rate limits](./rate-limits.md) — algorithm, scopes, `Retry-After`.
- [Outcomes](./outcomes.md) — every outcome category and when it's recorded.
