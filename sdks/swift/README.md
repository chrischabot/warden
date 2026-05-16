# sentry-replica (Swift SDK)

Swift SDK for sentry-replica. Mirrors the TypeScript, Python, Rust, and Go SDKs: DSN parsing, envelope construction, Event types, Scope/Hub state, transport protocol, URLSession-based HTTPTransport, NSException-aware capture.

Foundation-only (`Foundation`, `FoundationNetworking` on Linux). No external dependencies.

## Targets

| Platform | Status |
|----------|--------|
| Linux (Swift 5.10+) | Tested in CI |
| macOS / iOS | Source-level compatible; not exercised here |

## Build + test

```bash
cd sdks/swift
swift build
swift test
```

## Quick start

```swift
import SentryReplica

try SentryReplica.initialize(
    options: ClientOptions(dsn: "https://abc@relay.example.com/1")
)

SentryReplica.setUser(User(id: "u-123"))
SentryReplica.setTag("region", "eu-west")

SentryReplica.captureMessage("hello", level: .info)

SentryReplica.withScope { scope in
    scope.setExtra("request_id", .string("abc"))
    SentryReplica.captureMessage("inside")
}

_ = SentryReplica.flush(timeout: 2.0)
```