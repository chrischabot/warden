use sentry_replica_core::event::{Event, Level, User};
use sentry_replica_core::scope::Scope;
use serde_json::json;

#[test]
fn chainable_setters_store_values() {
    let mut s = Scope::new();
    s.set_user(Some(User {
        id: Some("u1".into()),
        ..Default::default()
    }));
    s.set_tag("region", "eu-west");
    s.set_extra("ctx", json!(42));
    s.set_level(Some(Level::Warning));
    s.set_fingerprint(Some(vec!["custom".into()]));
    assert_eq!(s.user().and_then(|u| u.id.as_deref()), Some("u1"));
    assert_eq!(s.tags().get("region").map(String::as_str), Some("eu-west"));
    assert_eq!(s.extras().get("ctx"), Some(&json!(42)));
    assert_eq!(s.level(), Some(Level::Warning));
    assert_eq!(s.fingerprint().map(|f| f.len()), Some(1));
}

#[test]
fn clear_wipes_everything() {
    let mut s = Scope::new();
    s.set_user(Some(User { id: Some("u".into()), ..Default::default() }));
    s.set_tag("k", "v");
    s.set_extra("e", json!(1));
    s.set_level(Some(Level::Error));
    s.set_fingerprint(Some(vec!["f".into()]));
    s.clear();
    assert!(s.user().is_none());
    assert!(s.tags().is_empty());
    assert!(s.extras().is_empty());
    assert!(s.level().is_none());
    assert!(s.fingerprint().is_none());
}

#[test]
fn clone_is_independent() {
    let mut s = Scope::new();
    s.set_tag("a", "1");
    let mut c = s.clone();
    c.set_tag("a", "2");
    c.set_tag("b", "3");
    assert_eq!(s.tags().get("a").unwrap(), "1");
    assert!(s.tags().get("b").is_none());
    assert_eq!(c.tags().get("a").unwrap(), "2");
    assert_eq!(c.tags().get("b").unwrap(), "3");
}

fn base_event() -> Event {
    Event {
        event_id: "x".repeat(32),
        timestamp: "2024-01-01T00:00:00Z".into(),
        ..Default::default()
    }
}

#[test]
fn apply_to_event_adds_user_when_absent() {
    let mut s = Scope::new();
    s.set_user(Some(User {
        id: Some("u1".into()),
        ..Default::default()
    }));
    let out = s.apply_to_event(base_event());
    assert_eq!(out.user.and_then(|u| u.id), Some("u1".into()));
}

#[test]
fn apply_to_event_preserves_event_user() {
    let mut s = Scope::new();
    s.set_user(Some(User {
        id: Some("scope".into()),
        ..Default::default()
    }));
    let mut event = base_event();
    event.user = Some(User {
        id: Some("event".into()),
        ..Default::default()
    });
    let out = s.apply_to_event(event);
    assert_eq!(out.user.and_then(|u| u.id), Some("event".into()));
}

#[test]
fn apply_to_event_merges_tags_event_wins() {
    let mut s = Scope::new();
    s.set_tag("a", "scope-a");
    s.set_tag("b", "scope-b");
    let mut event = base_event();
    event.tags.insert("a".into(), "event-a".into());
    let out = s.apply_to_event(event);
    assert_eq!(out.tags.get("a").unwrap(), "event-a");
    assert_eq!(out.tags.get("b").unwrap(), "scope-b");
}

#[test]
fn apply_to_event_adds_level_when_absent() {
    let mut s = Scope::new();
    s.set_level(Some(Level::Warning));
    let out = s.apply_to_event(base_event());
    assert_eq!(out.level, Some(Level::Warning));
}

#[test]
fn apply_to_event_preserves_event_level() {
    let mut s = Scope::new();
    s.set_level(Some(Level::Warning));
    let mut event = base_event();
    event.level = Some(Level::Fatal);
    let out = s.apply_to_event(event);
    assert_eq!(out.level, Some(Level::Fatal));
}