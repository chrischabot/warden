//! Per-request scope.

use crate::event::{Event, Level, User};
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct Scope {
    user: Option<User>,
    level: Option<Level>,
    fingerprint: Option<Vec<String>>,
    tags: HashMap<String, String>,
    extras: HashMap<String, serde_json::Value>,
    contexts: HashMap<String, serde_json::Value>,
}

impl Scope {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_user(&mut self, user: Option<User>) -> &mut Self {
        self.user = user;
        self
    }

    pub fn set_tag(&mut self, key: impl Into<String>, value: impl Into<String>) -> &mut Self {
        self.tags.insert(key.into(), value.into());
        self
    }

    pub fn set_extra(
        &mut self,
        key: impl Into<String>,
        value: serde_json::Value,
    ) -> &mut Self {
        self.extras.insert(key.into(), value);
        self
    }

    pub fn set_context(
        &mut self,
        key: impl Into<String>,
        value: serde_json::Value,
    ) -> &mut Self {
        self.contexts.insert(key.into(), value);
        self
    }

    pub fn set_level(&mut self, level: Option<Level>) -> &mut Self {
        self.level = level;
        self
    }

    pub fn set_fingerprint(&mut self, fp: Option<Vec<String>>) -> &mut Self {
        self.fingerprint = fp;
        self
    }

    pub fn clear(&mut self) -> &mut Self {
        self.user = None;
        self.level = None;
        self.fingerprint = None;
        self.tags.clear();
        self.extras.clear();
        self.contexts.clear();
        self
    }

    /// Apply scope values to event. Event-level values win on conflict.
    pub fn apply_to_event(&self, mut event: Event) -> Event {
        if event.user.is_none() {
            if let Some(u) = &self.user {
                event.user = Some(u.clone());
            }
        }
        if event.level.is_none() {
            event.level = self.level;
        }
        if event.fingerprint.is_none() {
            if let Some(fp) = &self.fingerprint {
                event.fingerprint = Some(fp.clone());
            }
        }
        for (k, v) in &self.tags {
            event.tags.entry(k.clone()).or_insert_with(|| v.clone());
        }
        for (k, v) in &self.extras {
            event.extra.entry(k.clone()).or_insert_with(|| v.clone());
        }
        for (k, v) in &self.contexts {
            event
                .contexts
                .entry(k.clone())
                .or_insert_with(|| v.clone());
        }
        event
    }

    // ---- diagnostics for tests ----

    pub fn user(&self) -> Option<&User> {
        self.user.as_ref()
    }
    pub fn level(&self) -> Option<Level> {
        self.level
    }
    pub fn fingerprint(&self) -> Option<&[String]> {
        self.fingerprint.as_deref()
    }
    pub fn tags(&self) -> &HashMap<String, String> {
        &self.tags
    }
    pub fn extras(&self) -> &HashMap<String, serde_json::Value> {
        &self.extras
    }
    pub fn contexts(&self) -> &HashMap<String, serde_json::Value> {
        &self.contexts
    }
}