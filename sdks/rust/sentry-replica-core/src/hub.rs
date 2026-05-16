//! Hub — current Client + scope stack.

use crate::client::Client;
use crate::event::{Event, Level, event_from_message};
use crate::scope::Scope;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub struct Hub {
    client: Option<Client>,
    stack: Vec<Scope>,
}

impl Hub {
    pub fn new(client: Option<Client>) -> Self {
        Self {
            client,
            stack: vec![Scope::new()],
        }
    }

    pub fn bind_client(&mut self, client: Client) {
        self.client = Some(client);
    }

    pub fn get_client(&self) -> Option<&Client> {
        self.client.as_ref()
    }

    pub fn get_scope(&mut self) -> &mut Scope {
        self.stack
            .last_mut()
            .expect("hub scope stack is never empty")
    }

    pub fn push_scope(&mut self) -> &mut Scope {
        let next = self
            .stack
            .last()
            .map(|s| s.clone())
            .unwrap_or_else(Scope::new);
        self.stack.push(next);
        self.stack.last_mut().expect("just pushed")
    }

    pub fn pop_scope(&mut self) {
        if self.stack.len() > 1 {
            self.stack.pop();
        }
    }

    pub fn with_scope<F, R>(&mut self, f: F) -> R
    where
        F: FnOnce(&mut Scope) -> R,
    {
        self.push_scope();
        let result = {
            let scope = self
                .stack
                .last_mut()
                .expect("just pushed");
            f(scope)
        };
        self.pop_scope();
        result
    }

    pub fn configure_scope<F>(&mut self, f: F)
    where
        F: FnOnce(&mut Scope),
    {
        f(self.get_scope());
    }

    pub fn capture_message(&mut self, message: &str, level: Option<Level>) -> String {
        let event = event_from_message(message, level);
        self.capture_event(event)
    }

    pub fn capture_event(&mut self, event: Event) -> String {
        if let Some(scope) = self.stack.last().cloned() {
            let final_event = scope.apply_to_event(event);
            if let Some(client) = &self.client {
                return client.capture_event(final_event);
            }
        }
        String::new()
    }

    pub fn flush(&self, timeout: Duration) -> bool {
        self.client.as_ref().map(|c| c.flush(timeout)).unwrap_or(true)
    }
}

static CURRENT_HUB: OnceLock<Mutex<Hub>> = OnceLock::new();

fn hub_mutex() -> &'static Mutex<Hub> {
    CURRENT_HUB.get_or_init(|| Mutex::new(Hub::new(None)))
}

/// Get a clone-on-access view of the current hub. For mutation, use `with_current_hub`.
pub fn current_hub() -> &'static Mutex<Hub> {
    hub_mutex()
}

/// Replace the current hub.
pub fn set_current_hub(hub: Hub) {
    let mutex = hub_mutex();
    *mutex.lock().expect("hub mutex poisoned") = hub;
}

/// Run `f` with mutable access to the current hub. Idiomatic for SDK helpers.
pub fn with_current_hub<R>(f: impl FnOnce(&mut Hub) -> R) -> R {
    let mutex = hub_mutex();
    let mut guard = mutex.lock().expect("hub mutex poisoned");
    f(&mut *guard)
}