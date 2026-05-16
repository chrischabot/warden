"""Hub tests."""
import json

import pytest

from sentry_replica.client import Client
from sentry_replica.envelope import parse_envelope
from sentry_replica.hub import Hub
from sentry_replica.transport import NoopTransport

DSN = "https://abc@relay.test/1"


def _new_hub():
    transport = NoopTransport()
    client = Client(dsn=DSN, transport=transport)
    return Hub(client=client), transport


def test_initial_scope_is_stable():
    hub, _ = _new_hub()
    assert hub.get_scope() is hub.get_scope()


def test_push_clone_pop():
    hub, _ = _new_hub()
    hub.get_scope().set_tag("a", "1")
    pushed = hub.push_scope()
    assert pushed.tags["a"] == "1"
    pushed.set_tag("a", "2")
    assert hub.get_scope().tags["a"] == "2"
    hub.pop_scope()
    assert hub.get_scope().tags["a"] == "1"


def test_pop_refuses_to_pop_root():
    hub, _ = _new_hub()
    hub.pop_scope()
    hub.pop_scope()
    assert hub.get_scope() is not None


def test_with_scope_isolates_mutations():
    hub, _ = _new_hub()
    hub.get_scope().set_tag("outer", "parent")
    hub.with_scope(lambda s: s.set_tag("outer", "child"))
    assert hub.get_scope().tags["outer"] == "parent"


def test_with_scope_pops_even_on_throw():
    hub, _ = _new_hub()
    hub.get_scope().set_tag("a", "1")

    def boom(s):
        s.set_tag("a", "2")
        raise ValueError("boom")

    with pytest.raises(ValueError):
        hub.with_scope(boom)
    assert hub.get_scope().tags["a"] == "1"


def test_capture_exception_applies_scope():
    hub, transport = _new_hub()
    hub.configure_scope(lambda s: s.set_user({"id": "u42"}).set_tag("request_id", "rid-1"))
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        eid = hub.capture_exception()
    assert eid
    _, items = parse_envelope(transport.sent[0])
    body = json.loads(items[0].payload)
    assert body["user"]["id"] == "u42"
    assert body["tags"]["request_id"] == "rid-1"


def test_capture_exception_no_client_returns_empty():
    hub = Hub()
    try:
        raise RuntimeError("x")
    except RuntimeError:
        assert hub.capture_exception() == ""


def test_capture_message_defaults_to_info():
    hub, transport = _new_hub()
    hub.capture_message("hello")
    _, items = parse_envelope(transport.sent[0])
    body = json.loads(items[0].payload)
    assert body["level"] == "info"


def test_capture_event_unlevelled_adopts_scope_level():
    hub, transport = _new_hub()
    hub.configure_scope(lambda s: s.set_level("warning"))
    hub.capture_event({"event_id": "0" * 32, "timestamp": "2024-01-01T00:00:00Z", "message": "x"})
    _, items = parse_envelope(transport.sent[0])
    body = json.loads(items[0].payload)
    assert body["level"] == "warning"