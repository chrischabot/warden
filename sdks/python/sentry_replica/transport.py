"""SDK transport."""
from __future__ import annotations

from typing import Protocol
from urllib.request import Request, urlopen


class Transport(Protocol):
    def send(self, envelope: bytes) -> None: ...
    def flush(self, timeout: float = 2.0) -> bool: ...
    def close(self, timeout: float = 2.0) -> bool: ...


class HttpTransport:
    """Synchronous HTTP transport using stdlib urllib.

    Production deployments will typically wrap this with a background-thread
    queue for non-blocking capture. v1 is synchronous so envelope delivery
    is observable via captured exceptions.
    """

    def __init__(
        self,
        envelope_url: str,
        *,
        timeout: float = 10.0,
        headers: dict[str, str] | None = None,
    ) -> None:
        if not isinstance(envelope_url, str) or not envelope_url:
            raise ValueError("HttpTransport: envelope_url is required")
        self.envelope_url = envelope_url
        self.timeout = timeout
        self.headers = {
            "Content-Type": "application/x-sentry-envelope",
            **(headers or {}),
        }

    def send(self, envelope: bytes) -> None:
        req = Request(self.envelope_url, data=envelope, method="POST", headers=self.headers)
        with urlopen(req, timeout=self.timeout) as resp:
            resp.read()

    def flush(self, timeout: float = 2.0) -> bool:
        return True

    def close(self, timeout: float = 2.0) -> bool:
        return True


class NoopTransport:
    """In-memory transport for tests. Records every envelope sent."""

    def __init__(self) -> None:
        self.sent: list[bytes] = []

    def send(self, envelope: bytes) -> None:
        self.sent.append(envelope)

    def flush(self, timeout: float = 2.0) -> bool:
        return True

    def close(self, timeout: float = 2.0) -> bool:
        return True