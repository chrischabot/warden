/**
 * Public SDK surface.
 *
 * Capture helpers route through the singleton Hub so the current
 * scope is applied automatically. `withScope(fn)` is the idiomatic
 * way to enrich a captured event without leaking state into
 * subsequent captures.
 */

import { Client } from './client';
import { getCurrentHub, Hub, setCurrentHub } from './hub';
import type { Scope } from './scope';
import type { CaptureOptions, ClientOptions, Event, SentryLevel, User } from './types';

export { Client, clientWithNoopTransport } from './client';
export * from './event';
export { getCurrentHub, Hub, setCurrentHub } from './hub';
export {
  installNodeErrorHandlers,
  uninstallNodeErrorHandlers,
} from './integrations/node';
export { Scope } from './scope';
export * from './stack-parser';
export * from './transport';
export * from './types';

/**
 * Configure the SDK. Creates a Client and binds it to the current
 * Hub. Returns the Client for advanced callers.
 */
export function init(options: ClientOptions): Client {
  const client = new Client(options);
  getCurrentHub().bindClient(client);
  return client;
}

/** Access the bound Client, if any. */
export function getCurrentClient(): Client | undefined {
  return getCurrentHub().getClient();
}

/** Capture an exception via the current Hub. */
export function captureException(err: unknown, options?: CaptureOptions): string {
  return getCurrentHub().captureException(err, options);
}

/** Capture a message via the current Hub. */
export function captureMessage(message: string, options?: CaptureOptions): string {
  return getCurrentHub().captureMessage(message, options);
}

/** Capture a pre-built event via the current Hub. */
export function captureEvent(event: Event): string {
  return getCurrentHub().captureEvent(event);
}

/** Run `fn` with a fresh cloned scope; rolls back on exit. */
export function withScope<T>(fn: (scope: Scope) => T): T {
  return getCurrentHub().withScope(fn);
}

/** Mutate the current scope in place. */
export function configureScope(fn: (scope: Scope) => void): void {
  getCurrentHub().configureScope(fn);
}

/** Convenience: set the user on the current scope. */
export function setUser(user: User | null): void {
  getCurrentHub().getScope().setUser(user);
}

/** Convenience: set a tag on the current scope. */
export function setTag(key: string, value: string): void {
  getCurrentHub().getScope().setTag(key, value);
}

/** Convenience: set an extra on the current scope. */
export function setExtra(key: string, value: unknown): void {
  getCurrentHub().getScope().setExtra(key, value);
}

/** Convenience: set a typed context on the current scope. */
export function setContext(key: string, value: unknown): void {
  getCurrentHub().getScope().setContext(key, value);
}

/** Convenience: set the level on the current scope. */
export function setLevel(level: SentryLevel | null): void {
  getCurrentHub().getScope().setLevel(level);
}

/** Flush the bound Client. */
export async function flush(timeoutMs?: number): Promise<boolean> {
  const c = getCurrentClient();
  return c ? c.flush(timeoutMs) : true;
}

/** Tear down the bound Client and reset the Hub. */
export async function close(timeoutMs?: number): Promise<boolean> {
  const c = getCurrentClient();
  if (!c) return true;
  const ok = await c.close(timeoutMs);
  setCurrentHub(new Hub());
  return ok;
}
