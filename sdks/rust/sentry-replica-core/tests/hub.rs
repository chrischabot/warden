use sentry_replica_core::envelope::parse_envelope;
use sentry_replica_core::event::{Event, Level, User};
use sentry_replica_core::transport::NoopTransport;
use sentry_replica_core::{Client, ClientOptions, Hub};
use serde_json::json;
use std::sync::Arc;

fn new_hub_with_transport() -> (Hub, Arc<NoopTransport>) {
    let transport = Arc::new(NoopTransport::new());
    let client = Client::new(ClientOptions {
        dsn: "https://abc@relay.test/1".into(),
        transport: Some(Box::new(NoopTransportRef(Arc::clone(&transport)))),
        release: None,
        environment: None,
    })
    .unwrap();
    (Hub::new(Some(client)), transport)
}

/// Newtype that delegates the Transport trait through an Arc, so the
/// test holds a stable handle while the Client takes ownership.
struct NoopTransportRef(Arc<NoopTransport>);
impl sentry_replica_core::transport::Transport for NoopTransportRef {
    fn send(
        &self,
        envelope: Vec<u8>,
    ) -> Result<(), sentry_replica_core::transport::TransportError> {
        self.0.send(envelope)
    }
}

#[test]
fn captures_message_and_returns_event_id() {
    let (mut hub, transport) = new_hub_with_transport();
    let id = hub.capture_message("hello", None);
    assert_eq!(id.len(), 32);
    assert_eq!(transport.len(), 1);
    let sent = transport.sent();
    let (_, items) = parse_envelope(&sent[0]).unwrap();
    let body: serde_json::Value = serde_json::from_slice(&items[0].payload).unwrap();
    assert_eq!(body["event_id"], id);
    assert_eq!(body["message"], "hello");
    assert_eq!(body["level"], "info");
    assert_eq!(body["platform"], "rust");
}

#[test]
fn scope_user_and_tag_apply_to_captured_message() {
    let (mut hub, transport) = new_hub_with_transport();
    hub.configure_scope(|s| {
        s.set_user(Some(User {
            id: Some("u42".into()),
            ..Default::default()
        }));
        s.set_tag("request_id", "rid-1");
    });
    hub.capture_message("with scope", Some(Level::Warning));
    let sent = transport.sent();
    let (_, items) = parse_envelope(&sent[0]).unwrap();
    let body: serde_json::Value = serde_json::from_slice(&items[0].payload).unwrap();
    assert_eq!(body["user"]["id"], "u42");
    assert_eq!(body["tags"]["request_id"], "rid-1");
    // capture_message passes a level explicitly, so scope-level merging defers to event.
    assert_eq!(body["level"], "warning");
}

#[test]
fn with_scope_isolates_mutations() {
    let (mut hub, transport) = new_hub_with_transport();
    hub.configure_scope(|s| {
        s.set_tag("outer", "parent");
    });
    hub.with_scope(|s| {
        s.set_tag("outer", "child");
    });
    hub.capture_message("after-with", None);
    let sent = transport.sent();
    let (_, items) = parse_envelope(&sent[0]).unwrap();
    let body: serde_json::Value = serde_json::from_slice(&items[0].payload).unwrap();
    assert_eq!(body["tags"]["outer"], "parent");
}

#[test]
fn capture_event_unlevelled_adopts_scope_level() {
    let (mut hub, transport) = new_hub_with_transport();
    hub.configure_scope(|s| {
        s.set_level(Some(Level::Warning));
    });
    let event = Event {
        event_id: "0".repeat(32),
        timestamp: "2024-01-01T00:00:00Z".into(),
        message: Some("no-level".into()),
        ..Default::default()
    };
    hub.capture_event(event);
    let sent = transport.sent();
    let (_, items) = parse_envelope(&sent[0]).unwrap();
    let body: serde_json::Value = serde_json::from_slice(&items[0].payload).unwrap();
    assert_eq!(body["level"], "warning");
}

#[test]
fn no_client_returns_empty_id() {
    let mut hub = Hub::new(None);
    let _ = json!({}); // silence unused-import noise if reordered
    assert_eq!(hub.capture_message("x", None), "");
}