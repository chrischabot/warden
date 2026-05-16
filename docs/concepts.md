# Concepts

The vocabulary the rest of the docs use.

## DSN

A **DSN** (Data Source Name) is the URL an SDK uses to identify which Warden host and which project to send to. It looks like:

```
<scheme>://<public_key>[:<secret>]@<host>[:<port>][/<path>]/<project_id>
```

Example:

```
https://abc123@warden.example.com/1
http://localpub@localhost:9000/1
```

The SDK splits the DSN into:

- **scheme**: `http` or `https`.
- **public_key**: identifies the project's ingest credential.
- **secret**: legacy field; not required.
- **host** and **port**: the relay's address.
- **path**: optional path prefix (e.g. `/api`) for reverse-proxy setups.
- **project_id**: numeric identifier the relay maps to a project row.

From the DSN the SDK derives:

```
envelope_url = <scheme>://<host>[:<port>][/<path>]/api/<project_id>/envelope/
store_url    = <scheme>://<host>[:<port>][/<path>]/api/<project_id>/store/
```

Warden uses the envelope URL. The store URL is the legacy single-event endpoint and is not exposed.

DSN parsing is implemented identically in every SDK (Python `parse_dsn`, Rust `parse_dsn`, Go `ParseDsn`, Swift `parseDSN`, JS `parseDsn`) and produces the same `{scheme, public_key, secret, host, port, path, project_id, envelope_url, store_url}` record.

## Envelope

An **envelope** is the on-the-wire container Warden ingests. It is newline-delimited:

```
{envelope_header_json}\n
{item_header_json}\n
{item_payload}\n
{item_header_json}\n
{item_payload}\n
...
```

The envelope header carries `event_id`, `sdk`, `dsn`, `sent_at`, and optional `trace` context. Each item declares its `type` (`event`, `transaction`, `log`, `session`, `replay_event`, `check_in`, `statsd`, `attachment`, etc.) and a content length so the parser can stream past binary payloads (like minidumps) without buffering them.

See [API: envelope](./api/envelope.md) for the full item-type list and validation rules.

## Event

An **event** is one captured observation. The shape is:

```jsonc
{
  "event_id": "<32-char lowercase hex>",
  "timestamp": "<ISO 8601 UTC>",
  "platform": "javascript|python|rust|go|swift|...",
  "level": "fatal|error|warning|info|debug",
  "message": "...",
  "exception": { "values": [ { "type": "...", "value": "...", "stacktrace": { "frames": [...] } } ] },
  "user": { "id": "...", "email": "...", "ip_address": "...", "username": "..." },
  "tags": { "key": "value" },
  "extra": { "key": "any json" },
  "contexts": { "os": {...}, "runtime": {...} },
  "release": "myapp@1.0.0",
  "environment": "production",
  "fingerprint": ["override", "for", "grouping"],
  "sdk": { "name": "...", "version": "..." }
}
```

The shape is identical across SDKs. See your SDK reference for the language-specific type.

## Transaction and span

A **transaction** is a top-level event with `type: "transaction"` carrying a `start_timestamp`, `timestamp`, and an embedded list of **spans**. Each span is `{span_id, parent_span_id, op, description, start_timestamp, timestamp, status, data}`. Transactions are grouped per `op` and per route on the server side for performance overview pages.

The SDKs currently expose event/exception/message capture; transaction APIs are reserved for a future SDK iteration. OTLP-sourced traces are converted into transaction + span shape on ingest.

## Scope and Hub

The **scope** is the per-task context an SDK carries: current `user`, `tags`, `extras`, `contexts`, `level`, `fingerprint`. Whenever an event is captured, the scope is merged into it (event values win on conflict) before the envelope is built.

The **hub** holds the current `Client` and a stack of scopes. Captures route through the hub's top scope. `withScope(fn)` (or its language equivalent) pushes a cloned scope, runs your function with it, and pops on exit — used for "enrich just these events without affecting global state."

Each SDK exposes the same operations:

- Mutate the current scope: `setUser`, `setTag`, `setExtra`, `setContext`, `setLevel`, `setFingerprint`.
- Temporary enrichment: `withScope(fn)`.
- Persistent enrichment: `configureScope(fn)`.

Scope isolation across concurrent tasks varies by language. Today the JS SDK is process-wide singleton; the Go SDK provides `Hub.Clone()` for goroutines; the Rust SDK exposes the hub as a global mutex. The Reporting guide covers patterns per language.

## Issue, group, fingerprint

When an event arrives the ingest worker computes a **fingerprint** from it. By default the fingerprint is the top in-app stack frames plus the exception type and value; the user can override it by setting `event.fingerprint`. The fingerprint is hashed (16-char lowercase hex of a 64-bit wyhash) into a **group hash**.

A **group** (also called an **issue**) is the bucket of all events that share a group hash. The web UI's *Issues* page lists groups, not individual events.

To deliberately split or join issues, override the fingerprint client-side. See [Reporting: fingerprinting](./reporting-guide.md#fingerprinting).

## Release

A **release** is a string you attach to every event your SDK sends, typically `myapp@1.0.0` or `myapp@<git-sha>`. Warden uses it for:

- **Regression detection** — was this group first seen before this release?
- **Release health** — what's the crash-free session rate for this release?
- **Source map lookup** — symbolicate frames using the source maps you uploaded against this release.

Set it once at `init()` time; every event picks it up via the scope merge.

## Outcome

An **outcome** is what the relay records for each envelope item, even (especially) when the item was dropped. Categories: `accepted`, `rate_limited`, `invalid`, `filtered` (e.g. dynamic-sample rejection), `over_quota`, `abuse`, `client_discard`, `network_error`. Outcomes are how Warden reports back to operators why their events did or did not land. See [API: outcomes](./api/outcomes.md).

## Topology

A **topology** is the computed plan for how many processes of each kind run on this host, derived from the host's logical core count at boot. See [Scaling and topology](./operations/scaling-and-topology.md) for the full formula set.
