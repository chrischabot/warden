"""Event builder tests."""
import re

import pytest

from sentry_replica.event import (
    event_from_exception,
    event_from_message,
    new_event_id,
    now_iso,
)


def test_new_event_id_is_32_hex():
    eid = new_event_id()
    assert re.fullmatch(r"[0-9a-f]{32}", eid)


def test_event_ids_are_unique():
    ids = {new_event_id() for _ in range(100)}
    assert len(ids) == 100


def test_now_iso_shape():
    s = now_iso()
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", s)


def test_event_from_exception_explicit():
    try:
        raise ValueError("boom")
    except ValueError as e:
        ev = event_from_exception(e)
    assert ev["platform"] == "python"
    assert ev["level"] == "error"
    assert ev["exception"]["values"][0]["type"] == "ValueError"
    assert ev["exception"]["values"][0]["value"] == "boom"
    assert ev["exception"]["values"][0]["stacktrace"]["frames"]


def test_event_from_exception_active():
    try:
        raise RuntimeError("active")
    except RuntimeError:
        ev = event_from_exception()
    assert ev["exception"]["values"][0]["type"] == "RuntimeError"
    assert ev["exception"]["values"][0]["value"] == "active"


def test_event_from_exception_no_active_raises():
    with pytest.raises(ValueError):
        event_from_exception()


def test_event_from_message():
    ev = event_from_message("hello")
    assert ev["platform"] == "python"
    assert ev["level"] == "info"
    assert ev["message"] == "hello"
    assert "exception" not in ev


def test_tags_extras_user_applied():
    ev = event_from_message(
        "x",
        tags={"region": "eu"},
        extra={"ctx": 1},
        user={"id": "u-1"},
    )
    assert ev["tags"] == {"region": "eu"}
    assert ev["extra"] == {"ctx": 1}
    assert ev["user"] == {"id": "u-1"}