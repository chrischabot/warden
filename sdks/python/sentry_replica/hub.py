"""Hub: current Client + scope stack."""
from __future__ import annotations

from typing import Any, Callable, Optional, TypeVar

from .client import Client
from .event import event_from_exception, event_from_message
from .scope import Scope

T = TypeVar("T")


class Hub:
    def __init__(self, client: Optional[Client] = None, scope: Optional[Scope] = None) -> None:
        self._client = client
        self._stack: list[Scope] = [scope or Scope()]

    def bind_client(self, client: Client) -> None:
        self._client = client

    def get_client(self) -> Optional[Client]:
        return self._client

    def get_scope(self) -> Scope:
        return self._stack[-1]

    def push_scope(self) -> Scope:
        next_scope = self.get_scope().clone()
        self._stack.append(next_scope)
        return next_scope

    def pop_scope(self) -> None:
        if len(self._stack) > 1:
            self._stack.pop()

    def with_scope(self, fn: Callable[[Scope], T]) -> T:
        scope = self.push_scope()
        try:
            return fn(scope)
        finally:
            self.pop_scope()

    def configure_scope(self, fn: Callable[[Scope], None]) -> None:
        fn(self.get_scope())

    def capture_exception(self, err: Optional[BaseException] = None, **options: Any) -> str:
        if self._client is None:
            return ""
        ev = event_from_exception(err, **options)
        ev = self.get_scope().apply_to_event(ev)
        return self._client.capture_event(ev)

    def capture_message(self, message: str, **options: Any) -> str:
        if self._client is None:
            return ""
        ev = event_from_message(message, **options)
        ev = self.get_scope().apply_to_event(ev)
        return self._client.capture_event(ev)

    def capture_event(self, event: dict[str, Any]) -> str:
        if self._client is None:
            return ""
        ev = self.get_scope().apply_to_event(event)
        return self._client.capture_event(ev)


_current_hub: Hub = Hub()


def get_current_hub() -> Hub:
    return _current_hub


def set_current_hub(hub: Hub) -> None:
    global _current_hub
    _current_hub = hub