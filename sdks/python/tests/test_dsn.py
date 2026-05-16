"""DSN parser tests."""
import pytest

from sentry_replica.dsn import Dsn, DsnError, parse_dsn


def test_minimal_dsn():
    dsn = parse_dsn("https://abc123@sentry.example.com/1")
    assert dsn.scheme == "https"
    assert dsn.public_key == "abc123"
    assert dsn.secret is None
    assert dsn.host == "sentry.example.com"
    assert dsn.port is None
    assert dsn.path == ""
    assert dsn.project_id == "1"
    assert dsn.envelope_url == "https://sentry.example.com/api/1/envelope/"
    assert dsn.store_url == "https://sentry.example.com/api/1/store/"


def test_dsn_with_secret_port_path():
    dsn = parse_dsn("http://pk:sk@localhost:9000/api/v2/42")
    assert dsn.scheme == "http"
    assert dsn.public_key == "pk"
    assert dsn.secret == "sk"
    assert dsn.host == "localhost"
    assert dsn.port == 9000
    assert dsn.path == "/api/v2"
    assert dsn.project_id == "42"
    assert dsn.envelope_url == "http://localhost:9000/api/v2/api/42/envelope/"


def test_large_project_id_preserved_as_string():
    dsn = parse_dsn("https://k@sentry.io/123456789012345")
    assert dsn.project_id == "123456789012345"


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "ftp://k@host/1",
        "https://@host/1",
        "https://k@/1",
        "https://k@host/",
        "https://k@host",
        "https://k@host/abc",
        "https://k@host:99999/1",
        "https://k@host:0/1",
    ],
)
def test_invalid_dsns(bad):
    with pytest.raises(DsnError):
        parse_dsn(bad)


def test_dsn_format_round_trip():
    s = "http://pk:sk@localhost:9000/api/v2/42"
    dsn = parse_dsn(s)
    assert parse_dsn(dsn.format()) == dsn


def test_dsn_is_frozen():
    dsn = parse_dsn("https://k@host/1")
    with pytest.raises(Exception):
        dsn.host = "other"  # type: ignore[misc]