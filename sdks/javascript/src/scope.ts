/**
 * Scope — per-request / per-task context applied to outgoing events.
 *
 * Holds:
 *   - user: identifies the affected user
 *   - tags: small key/value pairs indexed for search
 *   - extra: arbitrary structured context (not indexed)
 *   - contexts: typed context objects (e.g. `os`, `runtime`)
 *   - level: severity floor when the event doesn't set its own
 *   - fingerprint: server-side grouping override
 *
 * `applyToEvent(event)` returns a new Event with scope values
 * merged in. Event-level values always take precedence over scope
 * values, matching documented Sentry SDK behaviour.
 */

import type { Event, SentryLevel, User } from './types';

export class Scope {
  private _user: User | undefined;
  private _level: SentryLevel | undefined;
  private _fingerprint: string[] | undefined;
  private readonly _tags = new Map<string, string>();
  private readonly _extras = new Map<string, unknown>();
  private readonly _contexts = new Map<string, unknown>();

  setUser(user: User | null): this {
    this._user = user === null ? undefined : { ...user };
    return this;
  }

  setTag(key: string, value: string): this {
    this._tags.set(key, value);
    return this;
  }

  setTags(tags: Readonly<Record<string, string>>): this {
    for (const [k, v] of Object.entries(tags)) this._tags.set(k, v);
    return this;
  }

  setExtra(key: string, value: unknown): this {
    this._extras.set(key, value);
    return this;
  }

  setContext(key: string, value: unknown): this {
    this._contexts.set(key, value);
    return this;
  }

  setLevel(level: SentryLevel | null): this {
    this._level = level === null ? undefined : level;
    return this;
  }

  setFingerprint(fp: readonly string[] | null): this {
    this._fingerprint = fp === null ? undefined : [...fp];
    return this;
  }

  /** Clear every field. */
  clear(): this {
    this._user = undefined;
    this._level = undefined;
    this._fingerprint = undefined;
    this._tags.clear();
    this._extras.clear();
    this._contexts.clear();
    return this;
  }

  /** Deep-ish clone — independent maps, shallow-copied user/fingerprint. */
  clone(): Scope {
    const c = new Scope();
    if (this._user) c._user = { ...this._user };
    if (this._level) c._level = this._level;
    if (this._fingerprint) c._fingerprint = [...this._fingerprint];
    for (const [k, v] of this._tags) c._tags.set(k, v);
    for (const [k, v] of this._extras) c._extras.set(k, v);
    for (const [k, v] of this._contexts) c._contexts.set(k, v);
    return c;
  }

  /** Merge scope into event. Event-level values win on conflict. */
  applyToEvent(event: Event): Event {
    const out: Event = { ...event };
    if (!out.user && this._user) out.user = { ...this._user };
    if (!out.level && this._level) out.level = this._level;
    if (!('fingerprint' in out) && this._fingerprint) {
      (out as { fingerprint?: readonly string[] }).fingerprint = [...this._fingerprint];
    }
    if (this._tags.size > 0) {
      out.tags = { ...Object.fromEntries(this._tags), ...(event.tags ?? {}) };
    }
    if (this._extras.size > 0) {
      out.extra = { ...Object.fromEntries(this._extras), ...(event.extra ?? {}) };
    }
    if (this._contexts.size > 0) {
      const eventContexts = (event['contexts'] as Record<string, unknown> | undefined) ?? {};
      (out as { contexts?: Record<string, unknown> }).contexts = {
        ...Object.fromEntries(this._contexts),
        ...eventContexts,
      };
    }
    return out;
  }

  // Diagnostics for tests.
  get user(): Readonly<User> | undefined {
    return this._user;
  }
  get level(): SentryLevel | undefined {
    return this._level;
  }
  get fingerprint(): readonly string[] | undefined {
    return this._fingerprint;
  }
  get tags(): ReadonlyMap<string, string> {
    return this._tags;
  }
  get extras(): ReadonlyMap<string, unknown> {
    return this._extras;
  }
  get contexts(): ReadonlyMap<string, unknown> {
    return this._contexts;
  }
}
