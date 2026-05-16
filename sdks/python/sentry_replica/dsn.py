"""DSN parser."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

_DSN_RE = re.compile(
    r"^(https?)://([^:@/]+)(?::([^@/]+))?@([^:/]+)(?::(\d+))?(/.*)?$"
)


class DsnError(ValueError):
    """Raised when a DSN string fails to parse or validate."""


@dataclass(frozen=True)
class Dsn:
    scheme: str
    public_key: str
    secret: Optional[str]
    host: str
    port: Optional[int]
    path: str  # '' or '/foo' (without trailing project id)
    project_id: str  # decimal-digit string; kept as str to preserve leading zeros
    envelope_url: str
    store_url: str

    def format(self) -> str:
        auth = f"{self.public_key}:{self.secret}" if self.secret else self.public_key
        port = f":{self.port}" if self.port is not None else ""
        return f"{self.scheme}://{auth}@{self.host}{port}{self.path}/{self.project_id}"


def parse_dsn(s: str) -> Dsn:
    if not isinstance(s, str) or len(s) == 0:
        raise DsnError("DSN must be a non-empty string")
    m = _DSN_RE.match(s.strip())
    if not m:
        raise DsnError(f"DSN does not match expected pattern: {s!r}")
    scheme, public_key, secret, host, port_str, full_path = m.groups()
    full_path = full_path or "/"
    segments = [seg for seg in full_path.split("/") if seg]
    if not segments:
        raise DsnError("DSN must include a project id")
    project_id = segments[-1]
    if not project_id.isdigit():
        raise DsnError(f'DSN project_id must be numeric, got "{project_id}"')
    path_prefix = "/" + "/".join(segments[:-1]) if len(segments) > 1 else ""

    port: Optional[int] = None
    if port_str is not None:
        port = int(port_str)
        if not (1 <= port <= 65535):
            raise DsnError(f'DSN port must be 1-65535, got "{port_str}"')

    port_suffix = f":{port}" if port is not None else ""
    base = f"{scheme}://{host}{port_suffix}{path_prefix}"
    return Dsn(
        scheme=scheme,
        public_key=public_key,
        secret=secret,
        host=host,
        port=port,
        path=path_prefix,
        project_id=project_id,
        envelope_url=f"{base}/api/{project_id}/envelope/",
        store_url=f"{base}/api/{project_id}/store/",
    )