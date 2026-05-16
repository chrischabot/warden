"""Stack trace extraction from a Python traceback object."""
from __future__ import annotations

import traceback as _traceback
from types import TracebackType
from typing import Any, Optional


def parse_traceback(tb: Optional[TracebackType]) -> list[dict[str, Any]]:
    """Extract Sentry-compatible frames from a traceback. Oldest → newest."""
    if tb is None:
        return []
    frames: list[dict[str, Any]] = []
    for f in _traceback.extract_tb(tb):
        frame: dict[str, Any] = {
            "filename": f.filename,
            "abs_path": f.filename,
            "lineno": f.lineno,
            "function": f.name,
        }
        if f.line is not None:
            frame["context_line"] = f.line
        frames.append(frame)
    return frames