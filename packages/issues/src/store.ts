/**
 * In-memory issue (group) store.
 *
 * Spec §5.1 mandates the state machine:
 *
 *   unresolved -> resolved (user)
 *   resolved   -> unresolved + flag-as-regression (new event)
 *   unresolved -> ignored   (user; with optional snooze)
 *   ignored    -> unresolved (snooze expires; new event after expiry)
 *   *          -> archived  (user)
 *   archived   stays archived; never auto-reopens.
 *
 * Snooze policies (§5.1):
 *
 *   - untilEvents N : reopen on the N-th event after archival
 *   - untilUsers  N : reopen when N distinct users see it
 *   - untilTimestamp T : reopen on the next event at or after T ms epoch
 *
 * Any one snooze condition firing flips status back to `unresolved`
 * with `regression: true`.
 *
 * The store is keyed by `(projectId, groupHash)`. Group IDs are
 * ULID-shaped, monotone over time. Short IDs (`PROJ-N`) are
 * generated per project via a `ShortIdGenerator`.
 */

import { ShortIdGenerator } from './short-id';
import type {
  Group,
  GroupStatus,
  GroupType,
  IssueEvent,
  IssueListOptions,
  IssueListResult,
  IssueQuery,
  RecordResult,
  SentryLevel,
  SnoozePolicy,
  SortDir,
  SortField,
} from './types';
import { ulid } from './ulid';

const LEVEL_RANK: Record<SentryLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

export interface IssueStoreOptions {
  /** Map of project_id → slug for short-id generation. */
  readonly projectSlugs?: Readonly<Record<string, string>>;
  /**
   * "Now" function for tests. Defaults to `Date.now`.
   */
  readonly now?: () => number;
}

export class IssueStore {
  private readonly byKey = new Map<string, Group>();
  private readonly byId = new Map<string, Group>();
  private readonly shortIdGens = new Map<string, ShortIdGenerator>();
  private readonly projectSlugs: Record<string, string>;
  private readonly now: () => number;

  constructor(options: IssueStoreOptions = {}) {
    this.projectSlugs = options.projectSlugs ? { ...options.projectSlugs } : {};
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Ingest one event. Creates a new group if none exists for
   * `(projectId, groupHash)`; otherwise advances the existing
   * group's counters and applies the state-machine rules.
   */
  record(event: IssueEvent): RecordResult {
    const key = keyFor(event.projectId, event.groupHash);
    const existing = this.byKey.get(key);
    if (!existing) {
      const created = this.createGroup(event);
      this.byKey.set(key, created);
      this.byId.set(created.id, created);
      return Object.freeze({ group: created, created: true, regression: false });
    }
    const regression = this.advanceGroup(existing, event);
    return Object.freeze({ group: existing, created: false, regression });
  }

  /** Look up a group by its stable id. */
  get(groupId: string): Group | undefined {
    return this.byId.get(groupId);
  }

  /** Look up a group by `(projectId, groupHash)`. */
  getByHash(projectId: string, groupHash: string): Group | undefined {
    return this.byKey.get(keyFor(projectId, groupHash));
  }

  // ---- state transitions ----

  resolve(groupId: string): Group {
    const g = this.requireGroup(groupId);
    g.status = 'resolved';
    g.statusChangedAt = this.now();
    delete g.snooze;
    delete g.snoozeBaselineEvents;
    delete g.snoozeBaselineUsers;
    return g;
  }

  reopen(groupId: string): Group {
    const g = this.requireGroup(groupId);
    g.status = 'unresolved';
    g.statusChangedAt = this.now();
    delete g.snooze;
    delete g.snoozeBaselineEvents;
    delete g.snoozeBaselineUsers;
    return g;
  }

  ignore(groupId: string, policy?: SnoozePolicy): Group {
    const g = this.requireGroup(groupId);
    g.status = 'ignored';
    g.statusChangedAt = this.now();
    if (policy) {
      g.snooze = Object.freeze({ ...policy });
      g.snoozeBaselineEvents = g.timesSeen;
      g.snoozeBaselineUsers = g.userCount;
    } else {
      delete g.snooze;
      delete g.snoozeBaselineEvents;
      delete g.snoozeBaselineUsers;
    }
    return g;
  }

  archive(groupId: string): Group {
    const g = this.requireGroup(groupId);
    g.status = 'archived';
    g.statusChangedAt = this.now();
    delete g.snooze;
    delete g.snoozeBaselineEvents;
    delete g.snoozeBaselineUsers;
    return g;
  }

  assign(groupId: string, assigneeId: string | null): Group {
    const g = this.requireGroup(groupId);
    if (assigneeId === null) {
      delete g.assigneeId;
    } else {
      g.assigneeId = assigneeId;
    }
    return g;
  }

  /** Bulk operation: apply `op` to every matching group. Returns the changed count. */
  bulk(query: IssueQuery, op: (groupId: string) => void): number {
    const list = this.list(query, { limit: Number.MAX_SAFE_INTEGER });
    for (const g of list.groups) op(g.id);
    return list.groups.length;
  }

  // ---- queries ----

  list(query: IssueQuery = {}, options: IssueListOptions = {}): IssueListResult {
    const filtered: Group[] = [];
    for (const g of this.byId.values()) {
      if (matches(g, query)) filtered.push(g);
    }
    const sortBy: SortField = options.sortBy ?? 'last_seen';
    const sortDir: SortDir = options.sortDir ?? 'desc';
    sortGroups(filtered, sortBy, sortDir);
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const slice = filtered.slice(offset, offset + limit);
    return Object.freeze({
      groups: Object.freeze(slice),
      total: filtered.length,
    });
  }

  /** Iterate every group. Order not specified. */
  *all(): IterableIterator<Group> {
    yield* this.byId.values();
  }

  // ---- internals ----

  private createGroup(event: IssueEvent): Group {
    const id = ulid(this.now());
    const slug = this.projectSlugs[event.projectId] ?? `P${event.projectId}`;
    const gen = this.shortIdGens.get(event.projectId) ?? new ShortIdGenerator(slug);
    this.shortIdGens.set(event.projectId, gen);
    const shortId = gen.next();
    const users = new Set<string>();
    if (event.userId) users.add(event.userId);
    return {
      id,
      projectId: event.projectId,
      groupHash: event.groupHash,
      fingerprint: Object.freeze([...event.fingerprint]),
      type: event.type,
      shortId,
      status: 'unresolved',
      level: event.level,
      message: event.message,
      ...(event.culprit !== undefined ? { culprit: event.culprit } : {}),
      firstSeen: event.timestamp,
      lastSeen: event.timestamp,
      timesSeen: 1,
      userCount: users.size,
      users,
      ...(event.release !== undefined
        ? { release: event.release, firstRelease: event.release }
        : {}),
      isUnhandled: event.isUnhandled === true,
      statusChangedAt: this.now(),
      newAt: this.now(),
      hasRegressed: false,
    };
  }

  /**
   * Apply one event's effect to an existing group. Returns whether
   * a regression occurred (resolved → unresolved transition).
   */
  private advanceGroup(g: Group, event: IssueEvent): boolean {
    let regression = false;
    g.timesSeen += 1;
    if (event.timestamp > g.lastSeen) g.lastSeen = event.timestamp;
    if (event.timestamp < g.firstSeen) g.firstSeen = event.timestamp;
    if (event.userId && !g.users.has(event.userId)) {
      g.users.add(event.userId);
      g.userCount = g.users.size;
    }
    // Level monotonically rises to the worst seen.
    if (LEVEL_RANK[event.level] > LEVEL_RANK[g.level]) {
      g.level = event.level;
    }
    if (event.release !== undefined) {
      g.release = event.release;
      if (!g.firstRelease) g.firstRelease = event.release;
    }
    if (event.isUnhandled === true) g.isUnhandled = true;
    if (event.culprit !== undefined && !g.culprit) g.culprit = event.culprit;
    // Take the freshest message verbatim — Sentry uses last-seen text.
    if (event.message) g.message = event.message;

    // State-machine transitions.
    if (g.status === 'resolved') {
      this.regress(g, event.timestamp);
      regression = true;
    } else if (g.status === 'ignored' && g.snooze && this.snoozeExpired(g, event)) {
      this.regress(g, event.timestamp);
      regression = true;
    }
    return regression;
  }

  private regress(g: Group, eventTimestamp: number): void {
    g.status = 'unresolved';
    delete g.snooze;
    delete g.snoozeBaselineEvents;
    delete g.snoozeBaselineUsers;
    g.statusChangedAt = this.now();
    g.newAt = eventTimestamp;
    g.hasRegressed = true;
  }

  private snoozeExpired(g: Group, event: IssueEvent): boolean {
    const policy = g.snooze;
    if (!policy) return false;
    const baseEvents = g.snoozeBaselineEvents ?? 0;
    const baseUsers = g.snoozeBaselineUsers ?? 0;
    if (typeof policy.untilEvents === 'number' && g.timesSeen - baseEvents >= policy.untilEvents) {
      return true;
    }
    if (typeof policy.untilUsers === 'number' && g.userCount - baseUsers >= policy.untilUsers) {
      return true;
    }
    if (typeof policy.untilTimestamp === 'number' && event.timestamp >= policy.untilTimestamp) {
      return true;
    }
    return false;
  }

  private requireGroup(groupId: string): Group {
    const g = this.byId.get(groupId);
    if (!g) {
      throw new RangeError(`IssueStore: no group with id ${groupId}`);
    }
    return g;
  }
}

function keyFor(projectId: string, groupHash: string): string {
  return `${projectId}\u0000${groupHash}`;
}

function matches(g: Group, q: IssueQuery): boolean {
  if (q.projectId !== undefined && g.projectId !== q.projectId) return false;
  if (q.status && !q.status.includes(g.status)) return false;
  if (q.level && !q.level.includes(g.level)) return false;
  if (q.type && !q.type.includes(g.type)) return false;
  if (q.assigneeId !== undefined) {
    if (q.assigneeId === null) {
      if (g.assigneeId !== undefined) return false;
    } else if (g.assigneeId !== q.assigneeId) {
      return false;
    }
  }
  if (q.release !== undefined && g.release !== q.release) return false;
  if (q.searchSubstring) {
    const needle = q.searchSubstring.toLowerCase();
    const hay =
      g.message.toLowerCase() +
      ' ' +
      (g.culprit?.toLowerCase() ?? '') +
      ' ' +
      g.shortId.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (q.sinceLastSeen !== undefined && g.lastSeen < q.sinceLastSeen) return false;
  if (q.untilLastSeen !== undefined && g.lastSeen > q.untilLastSeen) return false;
  return true;
}

function sortGroups(groups: Group[], by: SortField, dir: SortDir): void {
  const mult = dir === 'asc' ? 1 : -1;
  groups.sort((a, b) => {
    let av: number;
    let bv: number;
    switch (by) {
      case 'first_seen':
        av = a.firstSeen;
        bv = b.firstSeen;
        break;
      case 'times_seen':
        av = a.timesSeen;
        bv = b.timesSeen;
        break;
      case 'user_count':
        av = a.userCount;
        bv = b.userCount;
        break;
      case 'last_seen':
      default:
        av = a.lastSeen;
        bv = b.lastSeen;
        break;
    }
    if (av === bv) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return (av - bv) * mult;
  });
}
