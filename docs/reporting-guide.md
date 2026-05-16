# Reporting guide

How to instrument an application well. The mechanics are language-specific; the patterns are not. This page covers both.

If you only need the language-specific API, jump to the [SDK reference](./sdks/README.md) for your language. If you've never used a Sentry-style SDK before, read this top to bottom.

## 1. Initialise once

Initialise the SDK once at process start, as early as possible. Capture-before-init silently drops the event.

```ts
import { init } from "@warden/sdk";

init({
  dsn: process.env.WARDEN_DSN!,
  release: process.env.GIT_SHA,
  environment: process.env.NODE_ENV,
});
```

```python
import sentry_replica, os
sentry_replica.init(
    dsn=os.environ["WARDEN_DSN"],
    release=os.environ.get("GIT_SHA"),
    environment=os.environ.get("ENV", "development"),
)
```

```rust
sentry_replica_core::init(ClientOptions {
    dsn: std::env::var("WARDEN_DSN").unwrap(),
    release: std::env::var("GIT_SHA").ok(),
    environment: std::env::var("ENV").ok(),
    transport: None,
})?;
```

```go
client, _ := sr.NewClient(sr.ClientOptions{
    DSN:         os.Getenv("WARDEN_DSN"),
    Release:     os.Getenv("GIT_SHA"),
    Environment: os.Getenv("ENV"),
})
hub := sr.NewHub(client)
```

```swift
let client = try SentryReplica.initialize(options: ClientOptions(
    dsn: ProcessInfo.processInfo.environment["WARDEN_DSN"]!,
    release: ProcessInfo.processInfo.environment["GIT_SHA"],
    environment: ProcessInfo.processInfo.environment["ENV"]
))
```

### Always set `release` and `environment`

- **`release`** unlocks regression detection and source-map / dSYM lookup. Use `myapp@<semver>`, `myapp@<git-sha>`, or `<service>@<build-number>`.
- **`environment`** lets the UI separate production from staging from dev. Don't put dev events in the production project.

## 2. Capture errors

### At the highest level you can

For unhandled errors, install the right hook for your runtime:

```ts
// Node
import { installNodeErrorHandlers } from "@warden/sdk";
installNodeErrorHandlers();
```

```python
import sys, sentry_replica
def _hook(t, e, tb): sentry_replica.capture_exception(e); sys.__excepthook__(t, e, tb)
sys.excepthook = _hook
```

```rust
sentry_replica_core::install_panic_hook();
```

```go
// in each goroutine boundary you own
defer hub.Recover()
```

```swift
// install in your AppDelegate / @main App init
NSSetUncaughtExceptionHandler { exception in
    SentryReplica.captureMessage(exception.reason ?? "uncaught", level: .fatal)
}
```

### At your own try/except boundaries

For errors you handle but want visibility on:

```ts
try { await chargeCard(orderId); }
catch (e) { captureException(e); throw; }
```

```python
try: charge_card(order_id)
except Exception:
    sentry_replica.capture_exception()
    raise
```

Re-raise (or re-throw) after capture so behaviour is unchanged. Capture should be a side effect, not a swallow.

## 3. Add context that helps debugging

Three layers, in order of permanence.

### Persistent (whole-process)

Set once after `init`. Applies to every event from this process.

```ts
configureScope((s) => {
  s.setTag("region", "eu-west-1");
  s.setTag("service", "api");
});
```

```python
sentry_replica.configure_scope(lambda s: (s.set_tag("region", "eu-west-1"), s.set_tag("service", "api")))
```

### Per-request (lifecycle-bound)

Set on entry to a handler, cleared on exit. Use **scope cloning** so it doesn't leak.

```ts
// Express example
app.use((req, _res, next) => {
  withScope((s) => {
    s.setTag("route", req.path);
    s.setUser({ id: req.userId, ip_address: req.ip });
    next();
  });
});
```

```go
// net/http
defer reqHub.WithScope(func(s *sr.Scope) {
    s.SetTag("route", r.URL.Path)
    s.SetUser(&sr.User{ID: r.Header.Get("X-User-Id")})
})
```

In Go, the idiomatic pattern is to `hub.Clone()` per request and pass that hub via `context.Context`.

### One-shot (for one capture)

Use `withScope` to enrich a single event without polluting the rest.

```ts
withScope((s) => {
  s.setExtra("orderId", orderId);
  s.setExtra("retry", attempt);
  captureMessage("charge failed", { level: "warning" });
});
```

## 4. Identify the user (carefully)

```ts
setUser({ id: user.id, email: user.email });
```

Same shape in every SDK: `id`, `email`, `username`, `ip_address` — all optional. The ID is what groups events to a user in the UI.

**PII**: the relay applies built-in scrubbing to email, phone, SSN, JWT, bearer tokens, etc. in the JSON payload — but you should still avoid sending data you don't need. Don't send the full user record if `id` is enough.

## 5. Tag for filtering, extra for debugging

- **Tags** are indexed and queryable (`tag.region = eu-west-1` in Discover). Keep them low-cardinality (region, service, route, version).
- **Extras** are not indexed. Stash large or high-cardinality structures here (request body, response body, retry count).
- **Contexts** are named structured blobs (`os`, `runtime`, `gpu`, custom). The UI renders them as tables.

Rule of thumb: if you want to filter on it, it's a tag. If you want to read it once you've found the event, it's an extra or a context.

## 6. Group the right way (fingerprints)

Warden's default grouping uses the top in-app frames plus the exception type and value. That's usually right. When it isn't:

- **A single root cause shows up as many issues.** Override the fingerprint to merge.
- **One group covers two distinct bugs.** Override the fingerprint to split.

```ts
withScope((s) => {
  s.setFingerprint(["billing", "stripe", e.code ?? "unknown"]);
  captureException(e);
});
```

The fingerprint is a list of strings; events that share the list end up in the same group. Wildcards aren't supported — use specific values.

## 7. Track releases

Set `release` at init. Then add deploy markers:

- **Tag commits/builds**: `myapp@$(git rev-parse --short HEAD)` is conventional.
- **Upload source maps** (or dSYMs / native debug files) per release so frames symbolicate. Use the SDK setup wizard for the matching CLI command per platform. See [Source maps](#source-maps) below.
- **Notify on deploy**: `POST /api/{org}/releases/` (read API in progress) records the release and starts regression tracking for it.

## 8. Source maps

For JavaScript, the SDK sends minified frames; the platform symbolicates them on read using uploaded source maps. The pattern that works:

1. Build with `--sourcemap` and a per-build `debug_id` (Sentry's bundler plugins emit one; replicate the pattern with `@warden/bundler-plugin` when published).
2. Upload the `*.js` + `*.js.map` pair with the same `debug_id`.
3. Capture an event from the deployed bundle. The relay reads `debug_id` from the frame, finds the matching uploaded map, and resolves the frame at query time.

The current implementation supports source-map v3 with a `debug_id` field; releases are matched by uploaded artifact's `release` field.

## 9. Flush before exit

The transport is fire-and-forget. If your process exits before pending sends complete, those events are lost. Call `flush()` before shutdown:

```ts
await getCurrentClient()?.flush(2000);
```

```python
sentry_replica.flush(timeout=2.0)
```

```rust
let _ = sentry_replica_core::flush(std::time::Duration::from_secs(2));
```

```go
client.Flush(2 * time.Second)
```

```swift
_ = SentryReplica.flush(timeout: 2.0)
```

In short-lived processes (scripts, lambdas), `flush` is the difference between seeing your errors and not seeing them.

## 10. Don't capture noise

Some events are not worth sending:

- **Expected validation errors** (the user typed a bad email). Log locally; capture only at the unexpected boundary.
- **Cancellations** (`CancelledError`, `context.Canceled`, `URLError(.cancelled)`). Filter at the capture site.
- **Aborted retries** that succeeded on the next try. Capture only the terminal failure.

The platform deduplicates by group, so capturing the same error 1,000 times still shows you one issue — but each capture costs a relay roundtrip and counts against your quota.

## 11. Test that it works

In each SDK there's a noop transport:

```ts
import { clientWithNoopTransport } from "@warden/sdk/client";
const { client, transport } = clientWithNoopTransport("http://x@localhost/1");
client.captureMessage("test");
expect(transport.sent).toHaveLength(1);
```

```python
from sentry_replica.transport import NoopTransport
t = NoopTransport()
sentry_replica.init(dsn="http://x@l/1", transport=t)
sentry_replica.capture_message("test")
assert len(t.sent) == 1
```

In Rust / Go / Swift the equivalents are `NoopTransport`. Wire it in your test setup.

## 12. Production readiness checklist

- [ ] `init` runs before any code that can throw.
- [ ] `release` and `environment` are set.
- [ ] Uncaught error/panic handler is installed.
- [ ] Per-request scope is bound on entry and cleared on exit.
- [ ] `flush()` is called on graceful shutdown.
- [ ] PII scrubbing is verified (capture a fake event with an email and confirm the stored event has `[Filtered]`).
- [ ] Source maps / dSYMs upload runs on every deploy.
- [ ] Quota / rate limits are sized for peak traffic. See [API: rate limits](./api/rate-limits.md).

## Where to read next

- Your SDK's full reference: [JavaScript](./sdks/javascript.md) · [Python](./sdks/python.md) · [Rust](./sdks/rust.md) · [Go](./sdks/go.md) · [Swift](./sdks/swift.md).
- [Web dashboard](./web-dashboard.md) — how the data you send is consumed in the UI.
- [Internals: grouping](./internals/grouping.md) — what the platform does with your fingerprint.
