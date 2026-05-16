# OTLP

OpenTelemetry interoperability over OTLP/JSON.

> **Status.** The OTLP decoders and converters live in [`packages/otlp`](../../packages/otlp/) and convert OTLP traces and logs to Warden's native envelope item shape. The HTTP route in the relay is in progress; this page documents the intended endpoint contract.

## Endpoints

```
POST /api/{project_id}/integration/otlp/v1/traces/
POST /api/{project_id}/integration/otlp/v1/logs/
```

The path is intentionally namespaced under `/integration/otlp/` so an upstream proxy can decide whether to expose OTLP at all without touching the envelope path.

## Authentication

Same DSN public-key model as the envelope endpoint:

```
X-Sentry-Auth: Sentry sentry_key=<public_key>, sentry_version=7
```

Or query parameter `?sentry_key=<public_key>` for OTLP exporters that don't allow custom headers.

The OpenTelemetry SDKs all support setting custom headers via `OTEL_EXPORTER_OTLP_HEADERS`:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://warden.example.com/api/1/integration/otlp"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/json"
export OTEL_EXPORTER_OTLP_HEADERS="X-Sentry-Auth=Sentry sentry_key=abc123\, sentry_version=7"
```

## Wire format

Standard OTLP/JSON per OpenTelemetry Protocol v1.x.

### Traces

```jsonc
POST /api/1/integration/otlp/v1/traces/
Content-Type: application/json

{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [{ "key": "service.name", "value": { "stringValue": "checkout" } }],
        "droppedAttributesCount": 0
      },
      "scopeSpans": [
        {
          "scope": { "name": "@opentelemetry/sdk-trace-node", "version": "1.18.0", "attributes": [] },
          "spans": [
            {
              "traceId": "5b8efff798038103d269b633813fc60c",
              "spanId": "eee19b7ec3c1b174",
              "parentSpanId": "",
              "name": "POST /checkout",
              "kind": 2,
              "startTimeUnixNano": "1748000000000000000",
              "endTimeUnixNano": "1748000000123000000",
              "attributes": [
                { "key": "http.method", "value": { "stringValue": "POST" } },
                { "key": "http.status_code", "value": { "intValue": "200" } }
              ],
              "events": [],
              "links": [],
              "status": { "code": 1, "message": "" }
            }
          ],
          "schemaUrl": ""
        }
      ],
      "schemaUrl": ""
    }
  ]
}
```

`kind`: `0` UNSPECIFIED, `1` INTERNAL, `2` SERVER, `3` CLIENT, `4` PRODUCER, `5` CONSUMER.

`status.code`: `0` UNSET, `1` OK, `2` ERROR.

### Logs

```jsonc
POST /api/1/integration/otlp/v1/logs/
Content-Type: application/json

{
  "resourceLogs": [
    {
      "resource": { "attributes": [...] },
      "scopeLogs": [
        {
          "scope": { "name": "...", "version": "..." },
          "logRecords": [
            {
              "timeUnixNano": "1748000000000000000",
              "observedTimeUnixNano": "1748000000000000000",
              "severityNumber": 17,
              "severityText": "ERROR",
              "body": { "stringValue": "request failed" },
              "attributes": [...],
              "traceId": "5b8efff798038103d269b633813fc60c",
              "spanId": "eee19b7ec3c1b174",
              "flags": 0
            }
          ]
        }
      ]
    }
  ]
}
```

`severityNumber`: 1–4 TRACE, 5–8 DEBUG, 9–12 INFO, 13–16 WARN, 17–20 ERROR, 21–24 FATAL.

## Conversion

On accept, the relay converts each OTLP record to a Warden envelope item:

| OTLP                | Warden item                          |
| ------------------- | ------------------------------------ |
| Span (any kind)     | `transaction` (if root) or span attached to one |
| LogRecord           | `log`                                |

Resource attributes are merged into the event's `contexts` and `tags`. `service.name` maps to project hint, `service.version` to `release`, `deployment.environment` to `environment`. The full conversion is defined in `packages/otlp/src/convert-traces.ts` and `convert-logs.ts`.

## Responses

| Code | Body                                                                                 |
| ---- | ------------------------------------------------------------------------------------ |
| 200  | `{"partialSuccess": {"rejectedSpans": 0, "errorMessage": ""}}` (per OTLP spec).      |
| 400  | OTLP/JSON failed to parse.                                                           |
| 401  | DSN auth failed.                                                                     |
| 413  | Body too large.                                                                       |
| 429  | Rate-limited. `Retry-After` header.                                                  |

## Unsupported

- **OTLP/protobuf wire**. The relay accepts JSON only. Configure your exporter with `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`.
- **OTLP/gRPC**. Not exposed.
- **OTLP metrics**. Not yet wired. Use Warden's custom-metrics surface or send StatsD via the envelope endpoint's `statsd` item type.

## Where to read next

- [Envelope ingest](./envelope.md) — the native ingest path. SDKs use this directly.
- [Concepts: Transaction and span](../concepts.md#transaction-and-span).
