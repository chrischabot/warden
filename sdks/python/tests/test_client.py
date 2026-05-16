"""Client and top-level API tests."""
import json

import pytest

import sentry_replica
from sentry_replica.client import Client
from sentry_replica.envelope import parse_envelope
from sentry_replica.hub import Hub, set_current_hub
from sentry_replica.transport import NoopTransport

DSN = "https://abc@relay.test/1"


@pytest.fixture
def isolated_hub():
    """Replace the singleton hub for the test, restore after."""
    original = sentry_replica.get_current_hub()
    transport = NoopTransport()
    client = Client(dsn=DSN, transport=transport)
    set_current_hub(Hub(client=client))
    try:
        yield transport
    finally:
        set_current_hub(original)


def test_client_capture_exception(isolated_hub):
    try:
        raise ValueError("boom")
    except ValueError:
        eid = sentry_replica.capture_exception()
    assert eid
    _, items = parse_envelope(isolated_hub.sent[0])
    body = json.loads(items[0].payload)
    assert body["event_id"] == eid
    assert body["exception"]["values"][0]["type"] == "ValueError"
    assert body["exception"]["values"][0]["value"] == "boom"


def test_client_capture_message(isolated_hub):
    sentry_replica.capture_message("hello world")
    _, items = parse_envelope(isolated_hub.sent[0])
    body = json.loads(items[0].payload)
    assert body["message"] == "hello world"
    assert body["level"] == "info"


def test_set_tag_persists(isolated_hub):
    sentry_replica.set_tag("region", "eu-west")
    try:
        raise RuntimeError("x")
    except RuntimeError:
        sentry_replica.capture_exception()
    _, items = parse_envelope(isolated_hub.sent[0])
    body = json.loads(items[0].payload)
    assert body["tags"]["region"] == "eu-west"


def test_with_scope_isolates(isolated_hub):
    sentry_replica.set_tag("outer", "parent")
    with sentry_replica.with_scope() as scope:
        scope.set_tag("outer", "child")
        try:
            raise RuntimeError("inside")
        except RuntimeError:
            sentry_replica.capture_exception()
    _, items = parse_envelope(isolated_hub.sent[0])
    inside_body = json.loads(items[0].payload)
    assert inside_body["tags"]["outer"] == "child"

    # After the with-scope, the outer scope is restored.
    try:
        raise RuntimeError("outside")
    except RuntimeError:
        sentry_replica.capture_exception()
    _, items_outside = parse_envelope(isolated_hub.sent[-1])
    outside_body = json.loads(items_outside[0].payload)
    assert outside_body["tags"]["outer"] == "parent"


def test_release_and_environment_defaults():
    transport = NoopTransport()
    client = Client(
        dsn=DSN, transport=transport, release="v1.2.3", environment="staging"
    )
    client.capture_message("hi")
    _, items = parse_envelope(transport.sent[0])
    body = json.loads(items[0].payload)
    assert body["release"] == "v1.2.3"
    assert body["environment"] == "staging"


def test_invalid_dsn_raises():
    with pytest.raises(Exception):
        Client(dsn="not-a-dsn")