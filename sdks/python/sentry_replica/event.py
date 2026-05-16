"""Event builders."""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .stacktrace import parse_traceback

SDK_NAME = "sentry-replica.python"
SDK_VERSION = "0.0.0"


def new_event_id() -> str:
    """32-char lowercase hex UUID4."""
    return uuid.uuid4().hex


def now_iso() -> str:
    """ISO 8601 timestamp in UTC."""
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def event_from_exception(
    err: Optional[BaseException] = None,
    *,
    level: str = "error",
    tags: Optional[dict[str, str]] = None,
    extra: Optional[dict[str, Any]] = None,
    user: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build an event from an exception (defaults to the currently-active one)."""
    if err is None:
        exc_info = sys.exc_info()
        err = exc_info[1]
    if err is None:
        raise ValueError("event_from_exception: no exception was provided or active")

    exc_type = type(err)
    exception_value: dict[str, Any] = {
        "type": exc_type.__name__,
        "value": str(err),
    }
    tb = err.__traceback__
    if tb is not None:
        frames = parse_traceback(tb)
        if frames:
            exception_value["stacktrace"] = {"frames": frames}

    return _build_base(
        level=level,
        tags=tags,
        extra=extra,
        user=user,
        extra_fields={"exception": {"values": [exception_value]}},
    )


def event_from_message(
    message: str,
    *,
    level: str = "info",
    tags: Optional[dict[str, str]] = None,
    extra: Optional[dict[str, Any]] = None,
    user: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Build a message-shaped event."""
    return _build_base(
        level=level,
        tags=tags,
        extra=extra,
        user=user,
        extra_fields={"message": message},
    )


def _build_base(
    *,
    level: str,
    tags: Optional[dict[str, str]],
    extra: Optional[dict[str, Any]],
    user: Optional[dict[str, Any]],
    extra_fields: dict[str, Any],
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "event_id": new_event_id(),
        "timestamp": now_iso(),
        "platform": "python",
        "level": level,
        "sdk": {"name": SDK_NAME, "version": SDK_VERSION},
        **extra_fields,
    }
    if tags:
        event["tags"] = dict(tags)
    if extra:
        event["extra"] = dict(extra)
    if user:
        event["user"] = dict(user)
    return event


def event_to_item_payload(event: dict[str, Any]) -> Item:  # type: ignore[name-defined]
    """Encode an event as a single envelope Item (type='event', JSON payload)."""
    import json as _json

    from .envelope import Item

    return Item(
        header={"type": "event"},
        payload=_json.dumps(event, separators=(",", ":")).encode("utf-8"),
    )