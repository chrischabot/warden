use sentry_replica_core::event::{event_from_message, new_event_id, now_iso, Level};

#[test]
fn new_event_id_is_32_hex() {
    let id = new_event_id();
    assert_eq!(id.len(), 32);
    assert!(id.chars().all(|c| c.is_ascii_hexdigit() && (c.is_ascii_digit() || c.is_lowercase())));
}

#[test]
fn event_ids_unique() {
    use std::collections::HashSet;
    let ids: HashSet<String> = (0..100).map(|_| new_event_id()).collect();
    assert_eq!(ids.len(), 100);
}

#[test]
fn now_iso_shape() {
    let s = now_iso();
    assert!(s.contains('T'));
    assert!(s.ends_with('Z'));
}

#[test]
fn event_from_message_basics() {
    let ev = event_from_message("hello", Some(Level::Warning));
    assert_eq!(ev.platform.as_deref(), Some("rust"));
    assert_eq!(ev.level, Some(Level::Warning));
    assert_eq!(ev.message.as_deref(), Some("hello"));
    assert!(ev.sdk.is_some());
}

#[test]
fn event_from_message_defaults_level_info() {
    let ev = event_from_message("hi", None);
    assert_eq!(ev.level, Some(Level::Info));
}

#[test]
fn event_serializes_to_json_with_skipped_options() {
    let ev = event_from_message("hi", None);
    let json = serde_json::to_value(&ev).unwrap();
    assert_eq!(json["message"], "hi");
    // exception is absent (Option<None> with skip_serializing_if).
    assert!(json.get("exception").is_none());
}