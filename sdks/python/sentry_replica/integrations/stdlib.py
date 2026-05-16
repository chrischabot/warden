"""Auto-capture of unhandled errors via sys.excepthook and threading.excepthook."""
from __future__ import annotations

import sys
import threading
from types import TracebackType
from typing import Any, Optional


_original_excepthook = sys.excepthook
_original_threading_excepthook = getattr(threading, "excepthook", None)
_installed = False


def install_excepthook() -> None:
    """Install hooks. Idempotent."""
    global _installed
    if _installed:
        return
    sys.excepthook = _sys_excepthook
    if hasattr(threading, "excepthook"):
        threading.excepthook = _thread_excepthook  # type: ignore[assignment]
    _installed = True


def uninstall_excepthook() -> None:
    """Restore the original hooks."""
    global _installed
    if not _installed:
        return
    sys.excepthook = _original_excepthook
    if _original_threading_excepthook is not None:
        threading.excepthook = _original_threading_excepthook  # type: ignore[assignment]
    _installed = False


def _sys_excepthook(
    exc_type: type[BaseException],
    exc_value: BaseException,
    exc_traceback: Optional[TracebackType],
) -> None:
    from .. import get_current_hub  # local import to avoid circular deps

    try:
        get_current_hub().capture_exception(exc_value, level="fatal")
    except Exception:
        # never raise from an excepthook
        pass
    # Chain to the original so the program still prints + exits.
    _original_excepthook(exc_type, exc_value, exc_traceback)


def _thread_excepthook(args: Any) -> None:
    from .. import get_current_hub

    try:
        get_current_hub().capture_exception(args.exc_value, level="error")
    except Exception:
        pass
    if _original_threading_excepthook is not None:
        _original_threading_excepthook(args)