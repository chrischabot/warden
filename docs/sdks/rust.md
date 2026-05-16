# Rust SDK reference

Source: [`sdks/rust/sentry-replica-core/src/`](../../sdks/rust/sentry-replica-core/src/).

Synchronous, zero-async-runtime-dependency. Capture from any thread; if you're inside a Tokio runtime, call from a `spawn_blocking` task. A panic hook captures uncaught panics as fatal events.

## Install

```toml
[dependencies]
sentry-replica-core = { path = "path/to/sdks/rust/sentry-replica-core" }
serde_json = "1"
```

(Or pull from a registry once published.)

## Initialisation

### `init(options: ClientOptions) -> Result<(), DsnError>`

```rust
use sentry_replica_core::{init, ClientOptions};

init(ClientOptions {
    dsn: "https://abc123@warden.example.com/1".into(),
    release: Some("myapp@1.0.0".into()),
    environment: Some("production".into()),
    transport: None,
})?;
```

Parses the DSN, constructs a `Client`, and binds it to the global `Hub`.

### `ClientOptions`

```rust
pub struct ClientOptions {
    pub dsn: String,
    pub transport: Option<Box<dyn Transport>>,
    pub release: Option<String>,
    pub environment: Option<String>,
}
```

If `transport` is `None`, the SDK defaults to an HTTP transport. (Today only `NoopTransport` is bundled; HTTP transports are user-provided implementations of the `Transport` trait.)

## Module-level capture

```rust
pub fn capture_message(message: &str, level: Option<Level>) -> String
pub fn capture_event(event: Event) -> String
pub fn flush(timeout: std::time::Duration) -> bool
```

All route through the global `Hub`. Return value is the `event_id` (32 hex chars).

To capture an exception, build an `Event` from the panic info (see panic hook below) or construct one manually with `Event { exception: Some(ExceptionInterface { ... }), ... }`.

## Hub

```rust
pub fn current_hub() -> &'static Mutex<Hub>
pub fn set_current_hub(hub: Hub)
pub fn with_current_hub<R>(f: impl FnOnce(&mut Hub) -> R) -> R
```

Idiomatic usage:

```rust
use sentry_replica_core::{with_current_hub, Level};

with_current_hub(|hub| {
    hub.with_scope(|s| {
        s.set_tag("worker", "checkout-1");
    });
    hub.capture_message("billing failed", Some(Level::Error));
});
```

### `Hub` methods

```rust
impl Hub {
    pub fn new(client: Option<Client>) -> Self
    pub fn bind_client(&mut self, client: Client)
    pub fn get_client(&self) -> Option<&Client>
    pub fn get_scope(&mut self) -> &mut Scope
    pub fn push_scope(&mut self) -> &mut Scope
    pub fn pop_scope(&mut self)
    pub fn with_scope<F, R>(&mut self, f: F) -> R where F: FnOnce(&mut Scope) -> R
    pub fn configure_scope<F>(&mut self, f: F) where F: FnOnce(&mut Scope)
    pub fn capture_message(&mut self, message: &str, level: Option<Level>) -> String
    pub fn capture_event(&mut self, event: Event) -> String
    pub fn flush(&self, timeout: Duration) -> bool
}
```

`with_scope` pushes a cloned scope, runs the closure, pops on return. `configure_scope` mutates the current scope in place.

## Scope

```rust
impl Scope {
    pub fn new() -> Self
    pub fn set_user(&mut self, user: Option<User>) -> &mut Self
    pub fn set_tag(&mut self, key: impl Into<String>, value: impl Into<String>) -> &mut Self
    pub fn set_extra(&mut self, key: impl Into<String>, value: serde_json::Value) -> &mut Self
    pub fn set_context(&mut self, key: impl Into<String>, value: serde_json::Value) -> &mut Self
    pub fn set_level(&mut self, level: Option<Level>) -> &mut Self
    pub fn set_fingerprint(&mut self, fp: Option<Vec<String>>) -> &mut Self
    pub fn clear(&mut self) -> &mut Self
    pub fn apply_to_event(&self, event: Event) -> Event

    // diagnostic getters
    pub fn user(&self) -> Option<&User>
    pub fn level(&self) -> Option<Level>
    pub fn fingerprint(&self) -> Option<&[String]>
    pub fn tags(&self) -> &HashMap<String, String>
    pub fn extras(&self) -> &HashMap<String, serde_json::Value>
    pub fn contexts(&self) -> &HashMap<String, serde_json::Value>
}
```

## Client

```rust
impl Client {
    pub fn new(options: ClientOptions) -> Result<Self, DsnError>
    pub fn capture_message(&self, message: &str, level: Option<Level>) -> String
    pub fn capture_event(&self, event: Event) -> String
    pub fn flush(&self, timeout: Duration) -> bool
    pub fn close(&self, timeout: Duration) -> bool
}
```

## Transport

```rust
pub trait Transport: Send + Sync {
    fn send(&self, envelope: Vec<u8>) -> Result<(), TransportError>;
    fn flush(&self, timeout: Duration) -> bool;
    fn close(&self, timeout: Duration) -> bool;
}

pub enum TransportError {
    Send(String),
    Closed,
}
```

### `NoopTransport`

```rust
pub struct NoopTransport;
impl NoopTransport {
    pub fn new() -> Self;
    pub fn sent(&self) -> Vec<Vec<u8>>;          // clone of recorded envelopes
    pub fn len(&self) -> usize;
    pub fn is_empty(&self) -> bool;
    pub fn clear(&self);
}
```

For an HTTP transport, implement `Transport` over `ureq`, `reqwest`, or `hyper` — the contract is small.

## Event types

```rust
pub struct Event {
    pub event_id: String,                                          // 32 hex
    pub timestamp: String,                                         // ISO 8601
    pub platform: Option<String>,
    pub level: Option<Level>,
    pub message: Option<String>,
    pub exception: Option<ExceptionInterface>,
    pub sdk: Option<SdkInfo>,
    pub user: Option<User>,
    pub tags: HashMap<String, String>,
    pub extra: HashMap<String, serde_json::Value>,
    pub contexts: HashMap<String, serde_json::Value>,
    pub release: Option<String>,
    pub environment: Option<String>,
    pub fingerprint: Option<Vec<String>>,
}

pub enum Level { Fatal, Error, Warning, Info, Debug }
impl Level { pub fn as_str(&self) -> &'static str; }

pub struct ExceptionInterface { pub values: Vec<ExceptionValue>; }
pub struct ExceptionValue { pub ty: String, pub value: String, pub stacktrace: Option<Stacktrace> }
pub struct Stacktrace { pub frames: Vec<Frame> }
pub struct Frame {
    pub function: Option<String>,
    pub abs_path: Option<String>,
    pub filename: Option<String>,
    pub lineno: Option<u32>,
    pub colno: Option<u32>,
    pub in_app: Option<bool>,
}
pub struct User {
    pub id: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
    pub ip_address: Option<String>,
}
pub struct SdkInfo { pub name: String, pub version: String }
```

## Event builders

```rust
pub fn new_event_id() -> String                                    // UUID v4 (no dashes)
pub fn now_iso() -> String                                         // ISO 8601 UTC

pub fn event_from_message(message: &str, level: Option<Level>) -> Event
pub fn event_from_panic(info: &std::panic::PanicHookInfo<'_>) -> Event
```

`event_from_panic` extracts `payload`, location, and a synthetic backtrace from a panic and produces a `fatal` event.

## Envelope codec

```rust
pub fn encode_envelope(header: &serde_json::Value, items: &[Item]) -> Vec<u8>
pub fn parse_envelope(bytes: &[u8]) -> Result<(serde_json::Value, Vec<Item>), EnvelopeError>

pub struct Item { pub header: serde_json::Value, pub payload: Vec<u8> }

pub enum EnvelopeError { Empty, Json(String), TruncatedPayload }
```

## DSN

```rust
pub fn parse_dsn(s: &str) -> Result<Dsn, DsnError>

pub struct Dsn {
    pub scheme: String,
    pub public_key: String,
    pub secret: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub path: String,
    pub project_id: String,
    pub envelope_url: String,
    pub store_url: String,
}

pub enum DsnError {
    Empty,
    BadShape(String),
    MissingProjectId,
    NonNumericProjectId(String),
    PortOutOfRange(String),
    BadScheme(String),
}
```

## Panic hook

```rust
pub fn install_panic_hook()
```

Installs a panic hook that captures the panic as a fatal `Event` and forwards it to the current `Hub`. Idempotent. Chains to the previous hook so existing logging continues to work.

```rust
sentry_replica_core::init(ClientOptions { dsn, ..Default::default() })?;
sentry_replica_core::install_panic_hook();
```

## Constants

```rust
pub const SDK_NAME: &str = "sentry-replica.rust";
pub const SDK_VERSION: &str = "0.0.0";
```

## Usage patterns

### Capture a custom error

```rust
use sentry_replica_core::{Event, ExceptionInterface, ExceptionValue, Level, capture_event};

fn capture<E: std::error::Error>(err: &E) {
    let event = Event {
        level: Some(Level::Error),
        exception: Some(ExceptionInterface {
            values: vec![ExceptionValue {
                ty: std::any::type_name::<E>().to_string(),
                value: err.to_string(),
                stacktrace: None,
            }],
        }),
        ..Default::default()
    };
    capture_event(event);
}
```

### Tokio

```rust
let sdk_init = tokio::task::spawn_blocking(|| {
    sentry_replica_core::init(/* ... */)
}).await??;
```

Capture from blocking contexts (`tokio::task::spawn_blocking`) because the default transport is synchronous.

## Limitations today

- No bundled HTTP transport. Plug your own via `Transport`.
- No transaction/span/breadcrumb API.
- No `capture_exception(&dyn Error)` helper (build an `Event` manually).
