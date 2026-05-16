"""SDK Client."""
from __future__ import annotations

from typing import Any, Optional

from .dsn import Dsn, parse_dsn
from .envelope import Item, encode_envelope
from .event import (
    SDK_NAME,
    SDK_VERSION,
    event_from_exception,
    event_from_message,
    event_to_item_payload,
    new_event_id,
    now_iso,
)
from .transport import HttpTransport, Transport


class Client:
    def __init__(
        self,
        dsn: str,
        *,
        transport: Optional[Transport] = None,
        release: Optional[str] = None,
        environment: Optional[str] = None,
    ) -> None:
        self.dsn: Dsn = parse_dsn(dsn)
        self.release = release
        self.environment = environment
        self.transport: Transport = transport or HttpTransport(self.dsn.envelope_url)

    def capture_exception(self, err: Optional[BaseException] = None, **options: Any) -> str:
        ev = event_from_exception(err, **options)
        return self.capture_event(ev)

    def capture_message(self, message: str, **options: Any) -> str:
        ev = event_from_message(message, **options)
        return self.capture_event(ev)

    def capture_event(self, event: dict[str, Any]) -> str:
        event = self._apply_defaults(event)
        item = event_to_item_payload(event)
        envelope_bytes = encode_envelope(
            header={
                "event_id": event["event_id"],
                "sent_at": event.get("timestamp", now_iso()),
                "dsn": self.dsn.envelope_url,
                "sdk": {"name": SDK_NAME, "version": SDK_VERSION},
            },
            items=[item],
        )
        try:
            self.transport.send(envelope_bytes)
        except Exception:
            # Fire-and-forget: don't propagate transport errors from capture.
            # Production wrappers should subclass to record/observe these.
            pass
        return event["event_id"]

    def flush(self, timeout: float = 2.0) -> bool:
        return self.transport.flush(timeout)

    def close(self, timeout: float = 2.0) -> bool:
        return self.transport.close(timeout)

    def _apply_defaults(self, event: dict[str, Any]) -> dict[str, Any]:
        event = dict(event)
        event.setdefault("event_id", new_event_id())
        event.setdefault("timestamp", now_iso())
        if self.release and "release" not in event:
            event["release"] = self.release
        if self.environment and "environment" not in event:
            event["environment"] = self.environment
        return event