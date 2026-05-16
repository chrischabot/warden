# SDK overview

Warden ships five SDKs, all speaking the Sentry envelope protocol. The core surface is intentionally consistent across languages so reading one of these references teaches you all five.

| SDK                                 | Path in repo            | Package name                                  |
| ----------------------------------- | ----------------------- | --------------------------------------------- |
| JavaScript / TypeScript             | `sdks/javascript/`      | `@warden/sdk` (workspace: `@sr/sdk-javascript`) |
| Python                              | `sdks/python/`          | `sentry-replica`                              |
| Rust                                | `sdks/rust/`            | `sentry-replica-core` (crate)                 |
| Go                                  | `sdks/go/`              | Module path: `github.com/chrischabot/warden/sdks/go` |
| Swift                               | `sdks/swift/`           | `SentryReplica` (SwiftPM)                     |

## Core surface (all SDKs)

Every SDK exposes:

- **Initialisation** — parse a DSN, build a Client, bind it to a Hub.
- **Capture** — `captureException`, `captureMessage`, `captureEvent` returning a 32-hex `event_id`.
- **Scope** — `setUser`, `setTag`, `setExtra`, `setContext`, `setLevel`, `setFingerprint`; `withScope(fn)` and `configureScope(fn)`.
- **Hub** — manages a stack of scopes; one default hub per process (per thread on Python).
- **Transport** — `HttpTransport` for production, `NoopTransport` for tests; pluggable via a `Transport` interface/trait/protocol.
- **Flush / close** — `flush(timeout)` and `close(timeout)`.

The data model is identical: `event_id`, `timestamp`, `platform`, `level`, `message`, `exception.values[].stacktrace.frames[]`, `user`, `tags`, `extra`, `contexts`, `release`, `environment`, `fingerprint`, `sdk: {name, version}`.

## Parity matrix

| Capability                  | JS    | Python | Rust  | Go    | Swift  |
| --------------------------- | ----- | ------ | ----- | ----- | ------ |
| `init` / Client             | ✅    | ✅     | ✅    | ✅    | ✅     |
| `captureException`          | ✅    | ✅     | (via panic hook + capture_event) | ✅    | ✅     |
| `captureMessage`            | ✅    | ✅     | ✅    | ✅    | ✅     |
| `captureEvent`              | ✅    | ✅     | ✅    | ✅    | ✅     |
| Scope: user/tag/extra/...   | ✅    | ✅     | ✅    | ✅    | ✅     |
| `withScope` / `configureScope` | ✅ | ✅     | ✅    | ✅    | ✅     |
| Hub                         | ✅    | ✅     | ✅    | ✅    | ✅     |
| Transport (HTTP + Noop)     | ✅    | ✅     | (Noop only; HTTP via custom impl) | ✅    | ✅     |
| Panic / uncaught capture    | Node only (`installNodeErrorHandlers`) | ✅ (via sys.excepthook patterns) | `install_panic_hook()` | `hub.Recover()` | ✅ (call from `NSApp` or signal handler) |
| Source-map / stacktrace     | ✅ V8/JSC | ✅ Python tb | ✅ via panic info | ✅ via `runtime.Caller` | ✅ via `Thread.callStackSymbols` |
| Async-safe scope            | TBD   | thread-local | global Mutex | per-Hub mutex + `Hub.Clone()` | NSLock-protected |
| Transaction / span API      | not yet | not yet | not yet | not yet | not yet |
| Breadcrumbs                 | not yet | not yet | not yet | not yet | not yet |
| Integrations (framework)    | Node error handlers | not yet | not yet | not yet | not yet |

Capabilities marked "not yet" are reserved in the spec and the envelope protocol; they will land in future SDK iterations without breaking the current surface.

## Choosing the right SDK

- **JavaScript / TypeScript**: any JS runtime (Node, Bun, browsers, Workers). The transport uses native `fetch`. The Node-side `installNodeErrorHandlers()` registers `uncaughtException` and `unhandledRejection`.
- **Python**: sync only. Wrap the transport for async if you need it.
- **Rust**: synchronous transport today; a panic hook captures fatals. Works in any Tokio context as long as you call from a blocking task.
- **Go**: per-request scope isolation via `hub.WithScope`, goroutine isolation via `hub.Clone()`. Use `defer hub.Recover()` for panic capture.
- **Swift**: `Sendable` types throughout, NSLock-protected Hub and Scope; works on iOS, macOS, and Linux.

## Where to read next

- The full reference for your language: [JavaScript](./javascript.md) · [Python](./python.md) · [Rust](./rust.md) · [Go](./go.md) · [Swift](./swift.md).
- [Reporting guide](../reporting-guide.md) — how to instrument correctly with examples in each language.
