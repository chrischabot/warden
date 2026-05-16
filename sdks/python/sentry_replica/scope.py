"""Per-request scope: user, tags, extras, contexts, level, fingerprint."""
from __future__ import annotations

from typing import Any, Optional


class Scope:
    """Per-request / per-task context applied to outgoing events."""

    def __init__(self) -> None:
        self._user: Optional[dict[str, Any]] = None
        self._level: Optional[str] = None
        self._fingerprint: Optional[list[str]] = None
        self._tags: dict[str, str] = {}
        self._extras: dict[str, Any] = {}
        self._contexts: dict[str, Any] = {}

    def set_user(self, user: Optional[dict[str, Any]]) -> "Scope":
        self._user = dict(user) if user else None
        return self

    def set_tag(self, key: str, value: str) -> "Scope":
        self._tags[key] = value
        return self

    def set_tags(self, tags: dict[str, str]) -> "Scope":
        self._tags.update(tags)
        return self

    def set_extra(self, key: str, value: Any) -> "Scope":
        self._extras[key] = value
        return self

    def set_context(self, key: str, value: Any) -> "Scope":
        self._contexts[key] = value
        return self

    def set_level(self, level: Optional[str]) -> "Scope":
        self._level = level
        return self

    def set_fingerprint(self, fp: Optional[list[str]]) -> "Scope":
        self._fingerprint = list(fp) if fp else None
        return self

    def clear(self) -> "Scope":
        self._user = None
        self._level = None
        self._fingerprint = None
        self._tags.clear()
        self._extras.clear()
        self._contexts.clear()
        return self

    def clone(self) -> "Scope":
        c = Scope()
        c._user = dict(self._user) if self._user else None
        c._level = self._level
        c._fingerprint = list(self._fingerprint) if self._fingerprint else None
        c._tags = dict(self._tags)
        c._extras = dict(self._extras)
        c._contexts = dict(self._contexts)
        return c

    def apply_to_event(self, event: dict[str, Any]) -> dict[str, Any]:
        """Merge scope values into event. Event-level values win on conflict."""
        out = dict(event)
        if "user" not in out and self._user:
            out["user"] = dict(self._user)
        if "level" not in out and self._level:
            out["level"] = self._level
        if "fingerprint" not in out and self._fingerprint:
            out["fingerprint"] = list(self._fingerprint)
        if self._tags:
            merged_tags = dict(self._tags)
            merged_tags.update(out.get("tags") or {})
            out["tags"] = merged_tags
        if self._extras:
            merged_extras = dict(self._extras)
            merged_extras.update(out.get("extra") or {})
            out["extra"] = merged_extras
        if self._contexts:
            merged_contexts = dict(self._contexts)
            merged_contexts.update(out.get("contexts") or {})
            out["contexts"] = merged_contexts
        return out

    # ---- diagnostics for tests ----

    @property
    def user(self) -> Optional[dict[str, Any]]:
        return self._user

    @property
    def level(self) -> Optional[str]:
        return self._level

    @property
    def fingerprint(self) -> Optional[list[str]]:
        return self._fingerprint

    @property
    def tags(self) -> dict[str, str]:
        return self._tags

    @property
    def extras(self) -> dict[str, Any]:
        return self._extras

    @property
    def contexts(self) -> dict[str, Any]:
        return self._contexts