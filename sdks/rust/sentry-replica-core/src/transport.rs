//! Transport interface and a noop implementation for tests.

use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    Send(String),
    Closed,
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransportError::Send(s) => write!(f, "transport send failed: {}", s),
            TransportError::Closed => write!(f, "transport is closed"),
        }
    }
}

impl std::error::Error for TransportError {}

pub trait Transport: Send + Sync {
    fn send(&self, envelope: Vec<u8>) -> Result<(), TransportError>;
    fn flush(&self, _timeout: Duration) -> bool {
        true
    }
    fn close(&self, _timeout: Duration) -> bool {
        true
    }
}

/// In-memory transport useful for tests and pre-init pipelines.
#[derive(Default, Debug)]
pub struct NoopTransport {
    sent: Mutex<Vec<Vec<u8>>>,
}

impl NoopTransport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sent(&self) -> Vec<Vec<u8>> {
        self.sent.lock().unwrap().clone()
    }

    pub fn len(&self) -> usize {
        self.sent.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear(&self) {
        self.sent.lock().unwrap().clear();
    }
}

impl Transport for NoopTransport {
    fn send(&self, envelope: Vec<u8>) -> Result<(), TransportError> {
        self.sent.lock().unwrap().push(envelope);
        Ok(())
    }
}