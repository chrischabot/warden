/**
 * Event builders.
 *
 * `eventFromException(err)` extracts `name` and `message` from an
 * Error (or wraps a non-Error into one) and parses its stack into
 * Frames. `eventFromMessage(msg)` builds a minimal message event.
 *
 * Both stamp:
 *   - `event_id`: 32-char lowercase hex from `crypto.randomUUID()`
 *   - `timestamp`: ISO 8601
 *   - `platform`: `javascript`
 *   - `sdk`: { name, version }
 */

import { parseStack } from './stack-parser';
import type { CaptureOptions, Event, ExceptionValue, Frame, SentryLevel } from './types';
import { SDK_NAME, SDK_VERSION } from './types';

/** UUID v4 with dashes removed (Sentry event_id format). */
export function newEventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** ISO 8601 timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function eventFromException(err: unknown, options: CaptureOptions = {}): Event {
  const error = coerceError(err);
  const exceptionValue: ExceptionValue = {
    type: error.name || 'Error',
    value: error.message || '',
  };
  if (typeof error.stack === 'string' && error.stack.length > 0) {
    const frames = parseStack(error.stack);
    if (frames.length > 0) exceptionValue.stacktrace = { frames };
  }
  return buildBase({ level: 'error', ...options }, error.message || error.name || 'unknown error', {
    exception: { values: [exceptionValue] },
  });
}

export function eventFromMessage(message: string, options: CaptureOptions = {}): Event {
  return buildBase({ level: 'info', ...options }, message, { message });
}

function buildBase(options: CaptureOptions, fallbackMessage: string, extra: Partial<Event>): Event {
  const level: SentryLevel = options.level ?? 'info';
  const event: Event = {
    event_id: newEventId(),
    timestamp: nowIso(),
    platform: 'javascript',
    level,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    ...(options.tags ? { tags: { ...options.tags } } : {}),
    ...(options.extra ? { extra: { ...options.extra } } : {}),
    ...(options.user ? { user: { ...options.user } } : {}),
    ...extra,
  };
  // Ensure we always have at least a placeholder message.
  if (!event.message && !event.exception) event.message = fallbackMessage;
  return event;
}

function coerceError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  if (err && typeof err === 'object' && 'message' in err) {
    const wrapped = new Error(String((err as { message: unknown }).message));
    if ('name' in err) wrapped.name = String((err as { name: unknown }).name);
    if ('stack' in err && typeof (err as { stack?: unknown }).stack === 'string') {
      wrapped.stack = (err as { stack: string }).stack;
    }
    return wrapped;
  }
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

/** Wrap an Event into an envelope-ready payload (event item). */
export function eventToItemPayload(event: Event): { payload: Uint8Array; type: 'event' } {
  return {
    payload: new TextEncoder().encode(JSON.stringify(event)),
    type: 'event',
  };
}

// Re-export Frame for downstream code that builds events directly.
export type { Frame };
