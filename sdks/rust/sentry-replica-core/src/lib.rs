//! sentry-replica core SDK.
//!
//! Provides the building blocks every other crate in the workspace
//! layers on top of: types, DSN parsing, envelope codec, Scope, Hub,
//! Client, the Transport trait, a NoopTransport for tests, and a
//! panic-hook installer.
//!
//! Mirrors the @sr/proto + JS/TS SDK contracts so envelopes produced
//! here are byte-compatible with the relay.

pub mod client;
pub mod dsn;
pub mod envelope;
pub mod event;
pub mod hub;
pub mod panic;
pub mod scope;
pub mod transport;

pub use client::{Client, ClientOptions};
pub use dsn::{Dsn, DsnError, parse_dsn};
pub use envelope::{Item, encode_envelope};
pub use event::{
    Event, ExceptionInterface, ExceptionValue, Frame, Level, SdkInfo, Stacktrace, User,
    event_from_message, event_from_panic, new_event_id, now_iso, SDK_NAME, SDK_VERSION,
};
pub use hub::{Hub, current_hub, set_current_hub, with_current_hub};
pub use panic::install_panic_hook;
pub use scope::Scope;
pub use transport::{NoopTransport, Transport, TransportError};

/// Top-level helper: configure the SDK by binding a Client to the current Hub.
pub fn init(options: ClientOptions) -> Result<(), DsnError> {
    let client = Client::new(options)?;
    with_current_hub(|hub| hub.bind_client(client));
    Ok(())
}

/// Capture a string message via the current Hub.
pub fn capture_message(message: &str, level: Option<Level>) -> String {
    with_current_hub(|hub| hub.capture_message(message, level))
}

/// Capture a pre-built event via the current Hub.
pub fn capture_event(event: Event) -> String {
    with_current_hub(|hub| hub.capture_event(event))
}

/// Flush the bound Client.
pub fn flush(timeout: std::time::Duration) -> bool {
    with_current_hub(|hub| hub.flush(timeout))
}