"""Scope tests."""
from sentry_replica.scope import Scope


def test_chainable_setters_store_values():
    s = (
        Scope()
        .set_user({"id": "u1"})
        .set_tag("region", "eu-west")
        .set_extra("ctx", 42)
        .set_level("warning")
        .set_fingerprint(["custom"])
    )
    assert s.user == {"id": "u1"}
    assert s.tags["region"] == "eu-west"
    assert s.extras["ctx"] == 42
    assert s.level == "warning"
    assert s.fingerprint == ["custom"]


def test_set_user_none_clears():
    s = Scope().set_user({"id": "x"}).set_user(None)
    assert s.user is None


def test_clear_wipes_everything():
    s = (
        Scope()
        .set_user({"id": "u"})
        .set_tag("k", "v")
        .set_extra("e", 1)
        .set_context("c", {"x": 1})
        .set_level("error")
        .set_fingerprint(["f"])
    )
    s.clear()
    assert s.user is None
    assert s.tags == {}
    assert s.extras == {}
    assert s.contexts == {}
    assert s.level is None
    assert s.fingerprint is None


def test_clone_is_independent():
    s = Scope().set_tag("a", "1")
    c = s.clone()
    c.set_tag("a", "2").set_tag("b", "3")
    assert s.tags["a"] == "1"
    assert "b" not in s.tags
    assert c.tags["a"] == "2"
    assert c.tags["b"] == "3"


def test_apply_to_event_adds_user_when_absent():
    s = Scope().set_user({"id": "u1"})
    out = s.apply_to_event({"event_id": "x", "timestamp": "2024"})
    assert out["user"] == {"id": "u1"}


def test_apply_to_event_event_wins_over_scope_user():
    s = Scope().set_user({"id": "scope"})
    out = s.apply_to_event({"event_id": "x", "user": {"id": "event"}})
    assert out["user"] == {"id": "event"}


def test_apply_to_event_merges_tags_with_event_winning():
    s = Scope().set_tag("a", "scope-a").set_tag("b", "scope-b")
    out = s.apply_to_event({"event_id": "x", "tags": {"a": "event-a"}})
    assert out["tags"]["a"] == "event-a"
    assert out["tags"]["b"] == "scope-b"


def test_apply_to_event_adds_level_when_absent():
    s = Scope().set_level("warning")
    out = s.apply_to_event({"event_id": "x"})
    assert out["level"] == "warning"


def test_apply_to_event_preserves_event_level():
    s = Scope().set_level("warning")
    out = s.apply_to_event({"event_id": "x", "level": "fatal"})
    assert out["level"] == "fatal"


def test_apply_to_event_adds_fingerprint():
    s = Scope().set_fingerprint(["a", "b"])
    out = s.apply_to_event({"event_id": "x"})
    assert out["fingerprint"] == ["a", "b"]


def test_apply_to_event_merges_contexts():
    s = Scope().set_context("os", {"name": "Linux"})
    out = s.apply_to_event({"event_id": "x"})
    assert out["contexts"]["os"] == {"name": "Linux"}