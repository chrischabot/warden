/**
 * Issue (group) types.
 *
 * A `Group` is the Sentry term for an aggregated cluster of events
 * sharing a fingerprint. The Issues product surface tracks each
 * group's state, counters, and lifecycle.
 *
 * The columnar event store retains the underlying events; this
 * module owns the group-level metadata that lives in
 * `bun:sqlite` (in Ring 8). For now the store is in-memory.
 */

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/**
 * Group status. Stable wire IDs are kept compact for the sqlite
 * column.
 *
 *   `unresolved` — actively occurring; the default for new issues.
 *   `resolved`   — declared fixed; will flip back to `unresolved`
 *                  with a `regression` event on next sighting.
 *   `ignored`    — user-acknowledged; no notifications until a
 *                  TTL-based threshold (`snooze_until`) elapses.
 *   `archived`   — deliberately silenced indefinitely; never auto-
 *                  reopens.
 */
export type GroupStatus = 'unresolved' | 'resolved' | 'ignored' | 'archived';

/**
 * What kind of signal the group aggregates. We carry the same
 * dimension as spec §3.2 envelope item types.
 */
export type GroupType = 'error' | 'transaction' | 'log' | 'profile' | 'replay';

/** Snooze policy: ignore until N events or M users see it, or a deadline. */
export interface SnoozePolicy {
  readonly untilEvents?: number;
  readonly untilUsers?: number;
  readonly untilTimestamp?: number;
}

/** A persistable group record. */
export interface Group {
  readonly id: string;
  readonly projectId: string;
  readonly groupHash: string;
  readonly fingerprint: readonly string[];
  readonly type: GroupType;
  readonly shortId: string;
  status: GroupStatus;
  level: SentryLevel;
  message: string;
  culprit?: string;
  firstSeen: number;
  lastSeen: number;
  timesSeen: number;
  userCount: number;
  /** Set of user identifiers we've seen for this group. */
  readonly users: Set<string>;
  release?: string;
  firstRelease?: string;
  assigneeId?: string;
  isUnhandled: boolean;
  /** Set when status === 'ignored' and a snooze policy is active. */
  snooze?: SnoozePolicy;
  /** timesSeen at the moment the current snooze was set. */
  snoozeBaselineEvents?: number;
  /** userCount at the moment the current snooze was set. */
  snoozeBaselineUsers?: number;
  /** Wall-clock timestamp at which the current status was set. */
  statusChangedAt: number;
  /** When the group was last "new" — set on creation and after a regression. */
  newAt: number;
  /** True iff this group has gone through at least one resolve → regression cycle. */
  hasRegressed: boolean;
}

/** Lightweight event projection that the store consumes. */
export interface IssueEvent {
  readonly projectId: string;
  readonly groupHash: string;
  readonly fingerprint: readonly string[];
  readonly type: GroupType;
  readonly level: SentryLevel;
  readonly message: string;
  readonly timestamp: number;
  readonly culprit?: string;
  readonly userId?: string;
  readonly release?: string;
  readonly isUnhandled?: boolean;
}

/** Result of recording one event into the store. */
export interface RecordResult {
  readonly group: Group;
  readonly created: boolean;
  readonly regression: boolean;
}

/** Query filter. All fields are AND-combined. */
export interface IssueQuery {
  readonly projectId?: string;
  readonly status?: readonly GroupStatus[];
  readonly level?: readonly SentryLevel[];
  readonly type?: readonly GroupType[];
  readonly assigneeId?: string | null;
  readonly release?: string;
  readonly searchSubstring?: string;
  readonly sinceLastSeen?: number;
  readonly untilLastSeen?: number;
}

export type SortField = 'last_seen' | 'first_seen' | 'times_seen' | 'user_count';
export type SortDir = 'asc' | 'desc';

export interface IssueListOptions {
  readonly sortBy?: SortField;
  readonly sortDir?: SortDir;
  readonly limit?: number;
  readonly offset?: number;
}

export interface IssueListResult {
  readonly groups: readonly Group[];
  readonly total: number;
}
