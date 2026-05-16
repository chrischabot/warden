//! Panic hook helper.

use crate::event::event_from_panic;
use crate::hub::with_current_hub;
use std::sync::OnceLock;

static INSTALLED: OnceLock<()> = OnceLock::new();

/// Install a panic hook that captures panics to the current Hub as fatal events.
/// Chains to the previous hook so program behaviour (printing, aborting) is
/// preserved. Idempotent.
pub fn install_panic_hook() {
    INSTALLED.get_or_init(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            // Capture defensively — a panic hook must never panic itself.
            let event = event_from_panic(info);
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                with_current_hub(|hub| {
                    hub.capture_event(event);
                });
            }));
            previous(info);
        }));
    });
}