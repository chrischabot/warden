# sentry-replica (Python SDK)

Python SDK for sentry-replica. Mirrors the TypeScript SDK's surface: `init`, `capture_exception`, `capture_message`, scope helpers, and a Hub-mediated current-scope.

## Install (development)

```bash
cd sdks/python
pip install -e ".[dev]"
pytest
```

## Quick start

```python
import sentry_replica

sentry_replica.init(dsn="https://abc@relay.example.com/1")

try:
    1 / 0
except Exception:
    sentry_replica.capture_exception()

sentry_replica.capture_message("hello world", level="info")
sentry_replica.flush()
```

Scope helpers:

```python
sentry_replica.set_user({"id": "u-123"})
sentry_replica.set_tag("region", "eu-west")

with sentry_replica.with_scope() as scope:
    scope.set_extra("request_id", "abc")
    sentry_replica.capture_exception()
```

Automatic capture of unhandled errors:

```python
from sentry_replica.integrations.stdlib import install_excepthook
install_excepthook()
```

## Tests

```bash
pytest sdks/python/
```

Runs entirely on stdlib + pytest; no external HTTP needed (a `NoopTransport` is provided for unit tests).