"""sentry-replica — Python SDK public surface."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Callable, Iterator, Optional

from .client import Client
from .dsn import Dsn, parse_dsn
from .envelope import Item, encode_envelope
from .event import event_from_exception, event_from_message, new_event_id, now_iso
from .hub import Hub, get_current_hub, set_current_hub
from .scope import Scope
from .stacktrace import parse_traceback
from .transport import HttpTransport, NoopTransport, Transport

__all__ = [
    "Client",
    "Dsn",
    "Hub",
    "Item",
    "Scope",
    "Transport",
    "HttpTransport",
    "NoopTransport",
    "capture_event",
    "capture_exception",
    "capture_message",
    "close",
    "configure_scope",
    "encode_envelope",
    "event_from_exception",
    "event_from_message",
    "flush",
    "get_current_client",
    "get_current_hub",
    "init",
    "new_event_id",
    "now_iso",
    "parse_dsn",
    "parse_traceback",
    "set_context",
    "set_current_hub",
    "set_extra",
    "set_level",
    "set_tag",
    "set_user",
    "with_scope",
]


def init(dsn: str, **kwargs: Any) -> Client:
    """Configure the SDK. Creates a Client and binds it to the current Hub."""
    client = Client(dsn=dsn, **kwargs)
    get_current_hub().bind_client(client)
    return client


def get_current_client() -> Optional[Client]:
    return get_current_hub().get_client()


def capture_exception(err: Optional[BaseException] = None, **options: Any) -> str:
    return get_current_hub().capture_exception(err, **options)


def capture_message(message: str, **options: Any) -> str:
    return get_current_hub().capture_message(message, **options)


def capture_event(event: dict[str, Any]) -> str:
    return get_current_hub().capture_event(event)


@contextmanager
def with_scope() -> Iterator[Scope]:
    """Push a cloned scope; mutations are popped on exit (even on throw)."""
    hub = get_current_hub()
    scope = hub.push_scope()
    try:
        yield scope
    finally:
        hub.pop_scope()


def configure_scope(fn: Callable[[Scope], None]) -> None:
    fn(get_current_hub().get_scope())


def set_user(user: Optional[dict[str, Any]]) -> None:
    get_current_hub().get_scope().set_user(user)


def set_tag(key: str, value: str) -> None:
    get_current_hub().get_scope().set_tag(key, value)


def set_extra(key: str, value: Any) -> None:
    get_current_hub().get_scope().set_extra(key, value)


def set_context(key: str, value: Any) -> None:
    get_current_hub().get_scope().set_context(key, value)


def set_level(level: Optional[str]) -> None:
    get_current_hub().get_scope().set_level(level)


def flush(timeout: float = 2.0) -> bool:
    client = get_current_client()
    return client.flush(timeout) if client else True


def close(timeout: float = 2.0) -> bool:
    client = get_current_client()
    if client is None:
        return True
    ok = client.close(timeout)
    set_current_hub(Hub())
    return ok