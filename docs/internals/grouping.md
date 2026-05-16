# Grouping

Source: [`packages/grouping/`](../../packages/grouping/).

Every event is bucketed into an **issue** (group). The grouping algorithm decides which events share a bucket.

## The algorithm

Per spec §3.4, in priority order:

1. **Explicit `event.fingerprint`** — if the SDK sent one, use it verbatim.
2. **In-app stack frames** — top N `in_app: true` frames, identified by `(module, function)`. N defaults to 5.
3. **Exception type and value** — `{type}: {value}` after lightweight normalization (numbers replaced with `?`, hex strings replaced with `?`).
4. **Message** — for message-only events, the message text after the same normalization.
5. **`"default"`** — final fallback so every event groups somewhere.

The first component that produces non-empty output wins; the resulting list of strings is the **fingerprint components**.

## The group hash

```
group_hash = lowercase_hex(wyhash64( components.join("|") ))
```

A 16-char lowercase hex string. This is what the columnar store uses for the shard key alongside `project_id`, and what the issue store uses as the issue's primary identifier.

## Override patterns

Override the fingerprint from the SDK when:

- **Generic exception types** are masking the real cause. `TypeError: undefined is not a function` from 30 different sites should split — fingerprint on `[type, frame.file, frame.function]`.
- **Per-customer details** are bloating the value into noise. `Failed to charge customer cus_abc123: card declined` — fingerprint on `["billing", "card_declined"]` so all the variants merge.
- **Wrapping** is hiding the real exception. If you catch and re-raise as a generic `ServiceError`, fingerprint on the inner cause.

Override from the SDK:

```ts
withScope((s) => {
  s.setFingerprint(["billing", "stripe", err.code ?? "unknown"]);
  captureException(err);
});
```

```python
with sentry_replica.with_scope() as s:
    s.set_fingerprint(["billing", "stripe", err.code or "unknown"])
    sentry_replica.capture_exception(err)
```

## Normalization

Before frames or messages are concatenated, the grouping module applies a small normalization pass to defang noisy fields:

- Decimal numbers → `?`
- Hex strings (UUIDs, IDs) → `?`
- Trailing line/column numbers in stack-frame strings are dropped (line moves don't break the group).

This is conservative on purpose — over-normalizing merges distinct bugs.

## Issue store

When an event arrives, the ingest worker:

1. Computes `group_hash` per above.
2. Looks up `(project_id, group_hash)` in the issue store (SQLite shard).
3. If the row exists, increments `last_seen`, `event_count`, `users_affected`. Possibly emits a "regression" event if the issue was previously resolved.
4. If not, creates the row, assigns a short ULID-based issue ID, sets `first_seen`, `last_seen`, `culprit`, `title`.
5. Writes the event to the columnar store with `(project_id, group_hash)` as the shard key, so all events for an issue land in one shard.

## ULIDs

Issue IDs are ULIDs (monotonic where possible) so they sort by creation time. The implementation lives in [`packages/issues/src/short-id.ts`](../../packages/issues/src/short-id.ts). Short ID alias (`PROJ-1234`) is generated for display.

## Where to read next

- [`packages/grouping/src/fingerprint.ts`](../../packages/grouping/src/fingerprint.ts) — the algorithm.
- [`packages/issues/src/store.ts`](../../packages/issues/src/store.ts) — issue persistence.
