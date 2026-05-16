//! DSN parser.

use std::fmt;

/// Parsed DSN.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dsn {
    pub scheme: String,
    pub public_key: String,
    pub secret: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    /// `""` or `"/foo"` — no trailing project id.
    pub path: String,
    /// Decimal-digit string; kept as a string to preserve leading zeros.
    pub project_id: String,
    pub envelope_url: String,
    pub store_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DsnError {
    Empty,
    BadShape(String),
    MissingProjectId,
    NonNumericProjectId(String),
    PortOutOfRange(String),
    BadScheme(String),
}

impl fmt::Display for DsnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DsnError::Empty => write!(f, "DSN must be a non-empty string"),
            DsnError::BadShape(s) => write!(f, "DSN does not match expected pattern: {:?}", s),
            DsnError::MissingProjectId => write!(f, "DSN must include a project id"),
            DsnError::NonNumericProjectId(s) => {
                write!(f, "DSN project_id must be numeric, got {:?}", s)
            }
            DsnError::PortOutOfRange(s) => write!(f, "DSN port must be 1-65535, got {:?}", s),
            DsnError::BadScheme(s) => write!(f, "DSN scheme must be http or https, got {:?}", s),
        }
    }
}

impl std::error::Error for DsnError {}

pub fn parse_dsn(s: &str) -> Result<Dsn, DsnError> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err(DsnError::Empty);
    }
    // Parse `<scheme>://<user[:secret]>@<host[:port]>[/path]`
    let scheme_end = trimmed.find("://").ok_or_else(|| DsnError::BadShape(s.into()))?;
    let scheme = &trimmed[..scheme_end];
    if scheme != "http" && scheme != "https" {
        return Err(DsnError::BadScheme(scheme.into()));
    }
    let rest = &trimmed[scheme_end + 3..];
    let at_pos = rest.find('@').ok_or_else(|| DsnError::BadShape(s.into()))?;
    let user_part = &rest[..at_pos];
    let host_part = &rest[at_pos + 1..];
    if user_part.is_empty() {
        return Err(DsnError::BadShape(s.into()));
    }
    let (public_key, secret) = match user_part.find(':') {
        Some(idx) => {
            let key = &user_part[..idx];
            let sec = &user_part[idx + 1..];
            if key.is_empty() || sec.is_empty() {
                return Err(DsnError::BadShape(s.into()));
            }
            (key.to_string(), Some(sec.to_string()))
        }
        None => (user_part.to_string(), None),
    };

    // Split host_part into `host[:port][/path]`.
    let (host_with_port, path_with_pid) = match host_part.find('/') {
        Some(idx) => (&host_part[..idx], &host_part[idx..]),
        None => (host_part, "/"),
    };
    if host_with_port.is_empty() {
        return Err(DsnError::BadShape(s.into()));
    }
    let (host, port) = match host_with_port.find(':') {
        Some(idx) => {
            let h = &host_with_port[..idx];
            let p_str = &host_with_port[idx + 1..];
            let p: u32 = p_str
                .parse()
                .map_err(|_| DsnError::PortOutOfRange(p_str.into()))?;
            if !(1..=65535).contains(&p) {
                return Err(DsnError::PortOutOfRange(p_str.into()));
            }
            (h.to_string(), Some(p as u16))
        }
        None => (host_with_port.to_string(), None),
    };
    if host.is_empty() {
        return Err(DsnError::BadShape(s.into()));
    }

    let segments: Vec<&str> = path_with_pid.split('/').filter(|seg| !seg.is_empty()).collect();
    let project_id = segments.last().ok_or(DsnError::MissingProjectId)?.to_string();
    if !project_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(DsnError::NonNumericProjectId(project_id));
    }
    let path = if segments.len() > 1 {
        format!("/{}", segments[..segments.len() - 1].join("/"))
    } else {
        String::new()
    };

    let port_suffix = port.map(|p| format!(":{}", p)).unwrap_or_default();
    let base = format!("{}://{}{}{}", scheme, host, port_suffix, path);
    let envelope_url = format!("{}/api/{}/envelope/", base, project_id);
    let store_url = format!("{}/api/{}/store/", base, project_id);

    Ok(Dsn {
        scheme: scheme.to_string(),
        public_key,
        secret,
        host,
        port,
        path,
        project_id,
        envelope_url,
        store_url,
    })
}