"""Envelope codec tests."""
import json

from sentry_replica.envelope import Item, encode_envelope, parse_envelope


def test_header_only():
    bytes_ = encode_envelope({"event_id": "abc"}, [])
    header, items = parse_envelope(bytes_)
    assert header == {"event_id": "abc"}
    assert items == []


def test_single_event_item_round_trip():
    payload = json.dumps({"message": "hi"}).encode("utf-8")
    bytes_ = encode_envelope({}, [Item(header={"type": "event"}, payload=payload)])
    header, items = parse_envelope(bytes_)
    assert len(items) == 1
    assert items[0].header["type"] == "event"
    assert items[0].header["length"] == len(payload)
    assert items[0].payload == payload


def test_binary_attachment_with_declared_length():
    payload = bytes(range(256))
    bytes_ = encode_envelope(
        {},
        [Item(header={"type": "attachment", "length": 256, "filename": "x"}, payload=payload)],
    )
    _, items = parse_envelope(bytes_)
    assert items[0].payload == payload
    assert items[0].header["filename"] == "x"


def test_multiple_items_in_order():
    items_in = [
        Item(header={"type": "event"}, payload=b"{}"),
        Item(header={"type": "session"}, payload=b'{"sid":"s"}'),
        Item(header={"type": "log"}, payload=b'{"k":"v"}'),
    ]
    bytes_ = encode_envelope({}, items_in)
    _, items_out = parse_envelope(bytes_)
    assert [i.header["type"] for i in items_out] == ["event", "session", "log"]
    assert items_out[0].payload == b"{}"


def test_high_bit_bytes_survive():
    payload = bytes([0, 10, 255, 254, 127, 128])
    bytes_ = encode_envelope(
        {}, [Item(header={"type": "attachment", "length": len(payload)}, payload=payload)]
    )
    _, items = parse_envelope(bytes_)
    assert items[0].payload == payload