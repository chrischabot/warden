use sentry_replica_core::{parse_dsn, DsnError};

#[test]
fn minimal_https_with_project_id() {
    let dsn = parse_dsn("https://abc123@sentry.example.com/1").unwrap();
    assert_eq!(dsn.scheme, "https");
    assert_eq!(dsn.public_key, "abc123");
    assert!(dsn.secret.is_none());
    assert_eq!(dsn.host, "sentry.example.com");
    assert!(dsn.port.is_none());
    assert_eq!(dsn.path, "");
    assert_eq!(dsn.project_id, "1");
    assert_eq!(dsn.envelope_url, "https://sentry.example.com/api/1/envelope/");
}

#[test]
fn http_with_secret_port_path() {
    let dsn = parse_dsn("http://pk:sk@localhost:9000/api/v2/42").unwrap();
    assert_eq!(dsn.scheme, "http");
    assert_eq!(dsn.public_key, "pk");
    assert_eq!(dsn.secret.as_deref(), Some("sk"));
    assert_eq!(dsn.host, "localhost");
    assert_eq!(dsn.port, Some(9000));
    assert_eq!(dsn.path, "/api/v2");
    assert_eq!(dsn.project_id, "42");
    assert_eq!(
        dsn.envelope_url,
        "http://localhost:9000/api/v2/api/42/envelope/"
    );
}

#[test]
fn large_project_id_preserved_as_string() {
    let dsn = parse_dsn("https://k@sentry.io/123456789012345").unwrap();
    assert_eq!(dsn.project_id, "123456789012345");
}

#[test]
fn rejects_empty() {
    assert_eq!(parse_dsn(""), Err(DsnError::Empty));
}

#[test]
fn rejects_bad_scheme() {
    assert!(matches!(parse_dsn("ftp://k@host/1"), Err(DsnError::BadScheme(_))));
}

#[test]
fn rejects_missing_public_key() {
    assert!(parse_dsn("https://@host/1").is_err());
}

#[test]
fn rejects_missing_host() {
    assert!(parse_dsn("https://k@/1").is_err());
}

#[test]
fn rejects_missing_project_id() {
    assert!(matches!(
        parse_dsn("https://k@host/"),
        Err(DsnError::MissingProjectId)
    ));
}

#[test]
fn rejects_non_numeric_project_id() {
    assert!(matches!(
        parse_dsn("https://k@host/abc"),
        Err(DsnError::NonNumericProjectId(_))
    ));
}

#[test]
fn rejects_port_out_of_range() {
    assert!(matches!(
        parse_dsn("https://k@host:99999/1"),
        Err(DsnError::PortOutOfRange(_))
    ));
    assert!(matches!(
        parse_dsn("https://k@host:0/1"),
        Err(DsnError::PortOutOfRange(_))
    ));
}