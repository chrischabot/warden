# PII scrubbing

Source: [`packages/pii/`](../../packages/pii/).

The relay scrubs personally identifiable information from envelope items before they're enqueued. Once an item is enqueued, the original payload is gone — there is no "unscrubbed" copy stored anywhere.

## What gets scrubbed

For every **JSON envelope item** (`event`, `transaction`, `log`, `replay_event`, `feedback`, etc.):

- The full JSON tree is walked.
- For each string leaf, every built-in pattern is applied in order.
- Matches are replaced with `[Filtered]` (configurable per project).

For **attachment items**, the bytes are passed through untouched. PII inside a minidump is not scrubbed at the relay; that's the SDK's responsibility (and the user's, when they decide to capture a minidump).

## Built-in patterns

Per spec, the relay ships these patterns enabled by default:

| Pattern              | What it matches                                       |
| -------------------- | ----------------------------------------------------- |
| `credit_card`        | 13–19 digit sequences passing Luhn check.             |
| `email`              | RFC 5322-ish email addresses.                          |
| `phone_e164`         | `+`-prefixed international phone numbers.              |
| `phone_national`     | Common national formats (US, EU, UK, etc.).            |
| `ssn`                | US social security numbers.                            |
| `iban`               | International bank account numbers.                    |
| `jwt`                | `xxx.yyy.zzz` shaped JWT tokens.                       |
| `bearer_token`       | `Bearer <opaque>` headers.                             |
| `aws_access_key`     | `AKIA[0-9A-Z]{16}`.                                    |
| `aws_secret_key`     | 40-char base64-ish secrets in context.                 |
| `gcp_service_key`    | GCP service account credential patterns.              |
| `azure_token`        | Azure CLI-style tokens.                                |
| `generic_secret`     | `password|api[_-]?key|secret|token` field names.       |

Built-in patterns are toggleable per project in **Project settings → PII scrubbing**.

## Custom patterns

Each project can add custom regex patterns:

```
projects.{id}.pii.custom = [
  { name: "internal_employee_id", regex: "EMP-\\d{6}", replacement: "[EMP]" },
  { name: "client_ref",            regex: "CRF-[A-Z0-9]{10}" }
]
```

Custom patterns run after built-ins in the order configured. Replacement defaults to `[Filtered]`.

## Pattern matching detail

- Each pattern is a single regex with the `g` flag — every match in the string is replaced, not just the first.
- Patterns run sequentially, on the current (possibly already-substituted) value.
- The walker descends into objects and arrays. It does not walk into typed binary fields (those don't exist in JSON).
- Long strings are scrubbed in place.

## Performance

PII scrubbing is the most expensive thing the relay does on the hot path. `sr_relay_pii_scrub_duration_seconds` tracks per-item cost. If your relay processes are CPU-bound, that's almost always PII regex. Mitigations:

- Disable patterns you don't need.
- Replace overly broad custom regex with anchored ones.
- Add a relay process (`max(2, cores/8)` is the floor, not the ceiling).

## What's not scrubbed

- **Attachment bodies** — by design. Minidumps and crash reports often contain stack-frame strings that look like PII but are not.
- **Field names** — only values. If you put an email in a field called `email`, that value gets scrubbed; the key stays.
- **Already-encoded payloads** — if you put a base64-encoded JSON string in a field, the base64 is opaque to the scrubber. Decode and re-encode if you need scrubbing inside.

## SDK side: avoid sending what you can

PII scrubbing at the relay is the safety net. The actual win is not sending sensitive data in the first place. The reporting guide ([Identify the user, carefully](../reporting-guide.md#4-identify-the-user-carefully)) covers the SDK-side pattern.

## Where to read next

- [`packages/pii/src/scrubber.ts`](../../packages/pii/src/scrubber.ts).
- [`packages/pii/src/patterns.ts`](../../packages/pii/src/patterns.ts) for the exact regex definitions.
