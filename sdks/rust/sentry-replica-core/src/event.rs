//! Event types and builders.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SDK_NAME: &str = "sentry-replica.rust";
pub const SDK_VERSION: &str = "0.0.0";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Fatal,
    Error,
    Warning,
    Info,
    Debug,
}

impl Level {
    pub fn as_str(&self) -> &'static str {
        match self {
            Level::Fatal => "fatal",
            Level::Error => "error",
            Level::Warning => "warning",
            Level::Info => "info",
            Level::Debug => "debug",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Frame {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "abs_path")]
    pub abs_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lineno: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colno: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_app: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Stacktrace {
    pub frames: Vec<Frame>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ExceptionValue {
    #[serde(rename = "type")]
    pub ty: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stacktrace: Option<Stacktrace>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct ExceptionInterface {
    pub values: Vec<ExceptionValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct SdkInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct User {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Event {
    pub event_id: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<Level>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exception: Option<ExceptionInterface>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk: Option<SdkInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<User>,
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    pub tags: HashMap<String, String>,
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    pub extra: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "HashMap::is_empty", default)]
    pub contexts: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<Vec<String>>,
}

/// 32-char lowercase hex UUID v4.
pub fn new_event_id() -> String {
    uuid::Uuid::new_v4().as_simple().to_string()
}

/// ISO 8601 timestamp in UTC.
pub fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string()
}

/// Build a message-shaped event.
pub fn event_from_message(message: &str, level: Option<Level>) -> Event {
    Event {
        event_id: new_event_id(),
        timestamp: now_iso(),
        platform: Some("rust".into()),
        level: Some(level.unwrap_or(Level::Info)),
        message: Some(message.to_string()),
        sdk: Some(SdkInfo {
            name: SDK_NAME.into(),
            version: SDK_VERSION.into(),
        }),
        ..Default::default()
    }
}

/// Build an event from a panic payload.
pub fn event_from_panic(info: &std::panic::PanicHookInfo<'_>) -> Event {
    let message = panic_message(info);
    let location = info.location().map(|l| (l.file().to_string(), l.line()));
    let mut frames = Vec::new();
    if let Some((file, line)) = location {
        frames.push(Frame {
            abs_path: Some(file.clone()),
            filename: Some(file),
            lineno: Some(line),
            in_app: Some(true),
            ..Default::default()
        });
    }
    let stacktrace = if frames.is_empty() { None } else { Some(Stacktrace { frames }) };
    let exception = ExceptionInterface {
        values: vec![ExceptionValue {
            ty: "panic".into(),
            value: message,
            stacktrace,
        }],
    };
    Event {
        event_id: new_event_id(),
        timestamp: now_iso(),
        platform: Some("rust".into()),
        level: Some(Level::Fatal),
        exception: Some(exception),
        sdk: Some(SdkInfo {
            name: SDK_NAME.into(),
            version: SDK_VERSION.into(),
        }),
        ..Default::default()
    }
}

fn panic_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    if let Some(s) = payload.downcast_ref::<&'static str>() {
        return (*s).to_string();
    }
    if let Some(s) = payload.downcast_ref::<String>() {
        return s.clone();
    }
    "panic".to_string()
}