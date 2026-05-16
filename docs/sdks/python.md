# Python SDK reference

Source: [`sdks/python/sentry_replica/`](../../sdks/python/sentry_replica/).

Pure-Python, synchronous. Compatible with Python 3.10+. Transport uses `urllib.request`. Hub is thread-local.

## Install

```bash
cd sdks/python && pip install -e .
```

Or, once published:

```bash
pip install sentry-replica
```

## Top-level functions

### `init(dsn: str, **kwargs) -> Client`

```python
import sentry_replica

sentry_replica.init(
    dsn="https://abc123@warden.example.com/1",
    release="myapp@1.0.0",
    environment="production",
)
```

| Keyword arg     | Type                      | Default | Notes                                 |
| --------------- | ------------------------- | ------- | ------------------------------------- |
| `transport`     | `Transport \| None`       | `None`  | Defaults to `HttpTransport(envelope_url)`. |
| `release`       | `str \| None`             | `None`  | Applied to every event.               |
| `environment`   | `str \| None`             | `None`  | Applied to every event.               |

Creates a `Client`, builds a `Hub`, and binds them to the thread-local current hub.

### `get_current_hub() -> Hub`
### `set_current_hub(hub: Hub) -> None`
### `get_current_client() -> Optional[Client]`

Thread-local accessors.

### `flush(timeout: float = 2.0) -> bool`
### `close(timeout: float = 2.0) -> bool`

Flush or close the current client. `close` also resets the thread-local hub.

## Event capture

### `capture_exception(err: Optional[BaseException] = None, **options) -> str`

Capture the current exception (from `sys.exc_info()`) or a provided one. Returns the event id.

```python
try:
    1 / 0
except ZeroDivisionError:
    sentry_replica.capture_exception()
```

### `capture_message(message: str, **options) -> str`

Capture a text message.

### `capture_event(event: dict[str, Any]) -> str`

Capture a pre-built event dict.

### Options (kwargs accepted by all three)

| Key          | Type                          | Notes                                       |
| ------------ | ----------------------------- | ------------------------------------------- |
| `level`      | `str`                          | `"fatal"`, `"error"`, `"warning"`, `"info"`, `"debug"`. |
| `tags`       | `dict[str, str]`               | Merged with scope tags.                     |
| `extra`      | `dict[str, Any]`               | Merged with scope extras.                   |
| `user`       | `dict[str, Any]`               | Overrides scope user for this event.        |

## Scope helpers (global)

### `with_scope() -> Iterator[Scope]` (context manager)

```python
with sentry_replica.with_scope() as scope:
    scope.set_tag("worker", "checkout-1")
    sentry_replica.capture_message("billing failed", level="error")
```

### `configure_scope(fn: Callable[[Scope], None]) -> None`

```python
sentry_replica.configure_scope(lambda s: s.set_tag("region", "eu-west-1"))
```

### `set_user(user: Optional[dict[str, Any]]) -> None`
### `set_tag(key: str, value: str) -> None`
### `set_extra(key: str, value: Any) -> None`
### `set_context(key: str, value: Any) -> None`
### `set_level(level: Optional[str]) -> None`

User dict shape:

```python
{
  "id": "...",            # optional
  "email": "...",         # optional
  "username": "...",      # optional
  "ip_address": "...",    # optional
}
```

## `Scope` class

```python
class Scope:
    def set_user(self, user: Optional[dict[str, Any]]) -> "Scope"
    def set_tag(self, key: str, value: str) -> "Scope"
    def set_tags(self, tags: dict[str, str]) -> "Scope"
    def set_extra(self, key: str, value: Any) -> "Scope"
    def set_context(self, key: str, value: Any) -> "Scope"
    def set_level(self, level: Optional[str]) -> "Scope"
    def set_fingerprint(self, fp: Optional[list[str]]) -> "Scope"
    def clear(self) -> "Scope"
    def clone(self) -> "Scope"
    def apply_to_event(self, event: dict[str, Any]) -> dict[str, Any]
```

All mutators return `self` for chaining.

## `Hub` class

```python
class Hub:
    def bind_client(self, client: Client) -> None
    def get_client(self) -> Optional[Client]
    def get_scope(self) -> Scope
    def push_scope(self) -> Scope
    def pop_scope(self) -> None
    def capture_exception(self, err=None, **options) -> str
    def capture_message(self, message, **options) -> str
    def capture_event(self, event) -> str
```

`get_current_hub()` returns a `threading.local()`-backed hub, so each thread gets its own without cross-thread leakage. To share a hub across threads explicitly, instantiate `Hub` once and call `set_current_hub(hub)` from each thread.

## `Client` class

```python
class Client:
    def __init__(self,
                 dsn: str, *,
                 transport: Optional[Transport] = None,
                 release: Optional[str] = None,
                 environment: Optional[str] = None) -> None

    def capture_exception(self, err=None, **options) -> str
    def capture_message(self, message, **options) -> str
    def capture_event(self, event) -> str

    def flush(self, timeout: float = 2.0) -> bool
    def close(self, timeout: float = 2.0) -> bool
```

## Transport

```python
class Transport(Protocol):
    def send(self, envelope: bytes) -> None: ...
    def flush(self, timeout: float = 2.0) -> bool: ...
    def close(self, timeout: float = 2.0) -> bool: ...
```

### `HttpTransport`

```python
HttpTransport(envelope_url: str, *,
              timeout: float = 10.0,
              headers: dict[str, str] | None = None)
```

Synchronous urllib POST. `flush` and `close` are no-ops (sync).

### `NoopTransport`

Captures envelopes in `transport.sent: list[bytes]`. Use for tests.

## Event helpers

```python
def event_from_exception(err=None, *, level="error", tags=None, extra=None, user=None) -> dict[str, Any]
def event_from_message(message, *, level="info", tags=None, extra=None, user=None) -> dict[str, Any]
def new_event_id() -> str                                 # 32-char lowercase hex
def now_iso() -> str                                      # ISO 8601 UTC
def event_to_item_payload(event) -> Item                  # envelope-ready
```

## Envelope codec

```python
def encode_envelope(header: dict[str, Any], items: Iterable[Item]) -> bytes
def parse_envelope(data: bytes) -> tuple[dict[str, Any], list[Item]]  # test-only

@dataclass
class Item:
    header: dict[str, Any]
    payload: bytes
```

## DSN

```python
@dataclass(frozen=True)
class Dsn:
    scheme: str
    public_key: str
    secret: Optional[str]
    host: str
    port: Optional[int]
    path: str
    project_id: str
    envelope_url: str
    store_url: str

def parse_dsn(s: str) -> Dsn
```

## Stack traces

```python
def parse_traceback(tb: Optional[TracebackType]) -> list[dict[str, Any]]
```

Walks a Python traceback and returns frames in the Sentry shape, in oldest-first order, suitable for `event["exception"]["values"][0]["stacktrace"]["frames"]`.

## Usage patterns

### `try/except` boundary

```python
try:
    run_job()
except Exception:
    sentry_replica.capture_exception()
    raise
```

### Unhandled exception hook

```python
import sys, sentry_replica
sentry_replica.init(dsn=os.environ["WARDEN_DSN"])

def _hook(exc_type, exc, tb):
    sentry_replica.capture_exception(exc)
    sys.__excepthook__(exc_type, exc, tb)

sys.excepthook = _hook
```

### Per-request enrichment (Flask example)

```python
@app.before_request
def _begin():
    sentry_replica.configure_scope(lambda s: (
        s.set_tag("route", request.endpoint or "unknown"),
        s.set_user({"id": getattr(g, "user_id", None)})
    ))
```

For per-request isolation, push a fresh hub per request or use `with sentry_replica.with_scope()` around the handler body.

## Limitations today

- Sync only. For asyncio, wrap `Client.flush` in `asyncio.to_thread` on shutdown.
- No transaction/span/breadcrumb API.
- No bundled Django/Flask/FastAPI integrations.
