# sentry-replica (Rust SDK)

Core Rust SDK for sentry-replica. Mirrors the TypeScript and Python SDKs: DSN parsing, envelope construction, Event types, Scope/Hub state, transport trait, panic hook.

## Crates

| Crate | Purpose |
|-------|---------|
| `sentry-replica-core` | Types, DSN, envelope codec, Scope, Hub, Client, Transport trait, NoopTransport, panic hook helper |

Subsequent crates from spec §4.2 (`sentry-replica-transport`, `-anyhow`, `-eyre`, `-tracing`, `-tower`, `-actix`, `-axum`, `-tokio`, `-panic`) layer on top.

## Build + test

```bash
cd sdks/rust
cargo build
cargo test
```

## Quick start

```rust
use sentry_replica_core::{init, capture_message, ClientOptions, NoopTransport, Level};

fn main() {
    let _ = init(ClientOptions {
        dsn: "https://abc@relay.example.com/1".into(),
        transport: Some(Box::new(NoopTransport::default())),
        release: None,
        environment: None,
    }).expect("init");
    capture_message("hello", Some(Level::Info));
}
```