"""Envelope codec."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class Item:
    """One envelope item: JSON header dict + binary payload bytes."""

    header: dict[str, Any]
    payload: bytes


def encode_envelope(header: dict[str, Any], items: Iterable[Item]) -> bytes:
    """Encode an envelope as `header_json\\n[item_header_json\\nitem_payload\\n]*`."""
    out = bytearray()
    out.extend(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    out.append(0x0A)
    for item in items:
        item_header = dict(item.header)
        if not isinstance(item_header.get("length"), int):
            item_header["length"] = len(item.payload)
        out.extend(json.dumps(item_header, separators=(",", ":")).encode("utf-8"))
        out.append(0x0A)
        out.extend(item.payload)
        out.append(0x0A)
    return bytes(out)


def parse_envelope(data: bytes) -> tuple[dict[str, Any], list[Item]]:
    """Parse an envelope (for tests). Returns (header, items)."""
    pos = 0
    line_end = data.find(b"\n", pos)
    if line_end < 0:
        raise ValueError("envelope is empty")
    header = json.loads(data[pos:line_end].decode("utf-8"))
    pos = line_end + 1
    items: list[Item] = []
    while pos < len(data):
        if data[pos] == 0x0A:
            pos += 1
            continue
        line_end = data.find(b"\n", pos)
        if line_end < 0:
            break
        item_header = json.loads(data[pos:line_end].decode("utf-8"))
        pos = line_end + 1
        declared = item_header.get("length")
        if isinstance(declared, int) and declared >= 0:
            if pos + declared > len(data):
                raise ValueError("item payload exceeds remaining buffer")
            payload = bytes(data[pos : pos + declared])
            pos += declared
            if pos < len(data) and data[pos] == 0x0A:
                pos += 1
        else:
            next_lf = data.find(b"\n", pos)
            if next_lf < 0:
                payload = bytes(data[pos:])
                pos = len(data)
            else:
                payload = bytes(data[pos:next_lf])
                pos = next_lf + 1
        items.append(Item(header=item_header, payload=payload))
    return header, items