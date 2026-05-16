//! SDK Client.

use crate::dsn::{Dsn, DsnError, parse_dsn};
use crate::envelope::{Item, encode_envelope};
use crate::event::{Event, Level, SDK_NAME, SDK_VERSION, SdkInfo, event_from_message, new_event_id, now_iso};
use crate::transport::{NoopTransport, Transport};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

pub struct ClientOptions {
    pub dsn: String,
    pub transport: Option<Box<dyn Transport>>,
    pub release: Option<String>,
    pub environment: Option<String>,
}

pub struct Client {
    pub dsn: Dsn,
    pub transport: Arc<dyn Transport>,
    pub release: Option<String>,
    pub environment: Option<String>,
}

impl Client {
    pub fn new(options: ClientOptions) -> Result<Self, DsnError> {
        let dsn = parse_dsn(&options.dsn)?;
        let transport: Arc<dyn Transport> = options
            .transport
            .map(Arc::from)
            .unwrap_or_else(|| Arc::new(NoopTransport::new()) as Arc<dyn Transport>);
        Ok(Self {
            dsn,
            transport,
            release: options.release,
            environment: options.environment,
        })
    }

    pub fn capture_message(&self, message: &str, level: Option<Level>) -> String {
        self.capture_event(event_from_message(message, level))
    }

    pub fn capture_event(&self, mut event: Event) -> String {
        self.apply_defaults(&mut event);
        let event_id = event.event_id.clone();

        let payload =
            serde_json::to_vec(&event).expect("Event serializes to JSON");
        let item = Item {
            header: json!({ "type": "event" }),
            payload,
        };
        let envelope_header = json!({
            "event_id": event.event_id,
            "sent_at": event.timestamp,
            "dsn": self.dsn.envelope_url,
            "sdk": SdkInfo { name: SDK_NAME.into(), version: SDK_VERSION.into() },
        });
        let bytes = encode_envelope(&envelope_header, &[item]);
        // Fire-and-forget; transport errors don't propagate from capture.
        let _ = self.transport.send(bytes);
        event_id
    }

    pub fn flush(&self, timeout: Duration) -> bool {
        self.transport.flush(timeout)
    }

    pub fn close(&self, timeout: Duration) -> bool {
        self.transport.close(timeout)
    }

    fn apply_defaults(&self, event: &mut Event) {
        if event.event_id.is_empty() {
            event.event_id = new_event_id();
        }
        if event.timestamp.is_empty() {
            event.timestamp = now_iso();
        }
        if self.release.is_some() && event.release.is_none() {
            event.release = self.release.clone();
        }
        if self.environment.is_some() && event.environment.is_none() {
            event.environment = self.environment.clone();
        }
    }
}