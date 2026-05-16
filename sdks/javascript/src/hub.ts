/**
 * Hub — current Client + scope-stack holder.
 *
 * Maintains a stack of `Scope`s; the top is the "current scope".
 * `withScope(fn)` pushes a cloned copy of the current scope, runs
 * `fn` with it, and pops on completion. `configureScope(fn)` lets
 * callers mutate the current scope directly.
 *
 * Capture methods build an Event, apply the current scope, and
 * forward to the bound Client.
 *
 * One Hub is created at module load. Async-context propagation
 * (Node `AsyncLocalStorage`) for per-task isolation is a follow-up
 * — for now the Hub is a process-wide singleton.
 */

import type { Client } from './client';
import { eventFromException, eventFromMessage } from './event';
import { Scope } from './scope';
import type { CaptureOptions, Event } from './types';

export class Hub {
  private client: Client | undefined;
  private readonly stack: Scope[];

  constructor(client?: Client, scope?: Scope) {
    this.client = client;
    this.stack = [scope ?? new Scope()];
  }

  bindClient(client: Client): void {
    this.client = client;
  }

  getClient(): Client | undefined {
    return this.client;
  }

  /** Current top-of-stack scope. */
  getScope(): Scope {
    return this.stack[this.stack.length - 1] as Scope;
  }

  /** Push a clone of the current scope; return the new top. */
  pushScope(): Scope {
    const next = this.getScope().clone();
    this.stack.push(next);
    return next;
  }

  /** Pop the top scope. No-op if only the root remains. */
  popScope(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  /**
   * Push a scope, run `fn`, pop on return — even on throw.
   * The pushed scope is a clone of the current scope so callers can
   * mutate it without affecting the parent.
   */
  withScope<T>(fn: (scope: Scope) => T): T {
    const scope = this.pushScope();
    try {
      return fn(scope);
    } finally {
      this.popScope();
    }
  }

  /** Mutate the current scope in place. */
  configureScope(fn: (scope: Scope) => void): void {
    fn(this.getScope());
  }

  /** Capture an exception with the current scope applied. */
  captureException(err: unknown, options: CaptureOptions = {}): string {
    if (!this.client) return '';
    const base = eventFromException(err, options);
    const withScope = this.getScope().applyToEvent(base);
    return this.client.captureEvent(withScope);
  }

  /** Capture a message with the current scope applied. */
  captureMessage(message: string, options: CaptureOptions = {}): string {
    if (!this.client) return '';
    const base = eventFromMessage(message, options);
    const withScope = this.getScope().applyToEvent(base);
    return this.client.captureEvent(withScope);
  }

  /** Capture a pre-built event with the current scope applied. */
  captureEvent(event: Event): string {
    if (!this.client) return '';
    const withScope = this.getScope().applyToEvent(event);
    return this.client.captureEvent(withScope);
  }
}

// Module-level singleton.
let currentHub: Hub = new Hub();

/** Current Hub. Replace via `setCurrentHub`. */
export function getCurrentHub(): Hub {
  return currentHub;
}

/** Replace the current Hub. Tests may use this for isolation. */
export function setCurrentHub(hub: Hub): void {
  currentHub = hub;
}
