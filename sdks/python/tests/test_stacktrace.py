"""Stack trace parser tests."""
from sentry_replica.stacktrace import parse_traceback


def test_none_returns_empty():
    assert parse_traceback(None) == []


def test_basic_extraction():
    def inner():
        raise RuntimeError("boom")

    def outer():
        inner()

    try:
        outer()
    except RuntimeError as e:
        frames = parse_traceback(e.__traceback__)
    # Oldest → newest: should include the test function, outer, inner.
    assert len(frames) >= 2
    fn_names = [f["function"] for f in frames]
    assert "outer" in fn_names
    assert "inner" in fn_names
    # `inner` is at the end (most recent call).
    assert fn_names[-1] == "inner"


def test_frame_fields():
    try:
        raise ValueError("x")
    except ValueError as e:
        frames = parse_traceback(e.__traceback__)
    f = frames[-1]
    assert "filename" in f
    assert "abs_path" in f
    assert "lineno" in f
    assert "function" in f
    assert isinstance(f["lineno"], int)