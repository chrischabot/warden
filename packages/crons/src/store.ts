/**
 * Cron monitor store.
 *
 * State is held in memory and threaded by:
 *
 *   - `createMonitor(input)`    — register a new monitor
 *   - `checkIn(...)`            — record a check-in (in_progress / ok / error)
 *   - `evaluate(now)`           — advance state: mark missed/timeout for
 *                                 any tick or open run whose deadlines have
 *                                 passed.
 *
 * `evaluate` is idempotent: calling it twice for the same `now`
 * produces no additional transitions.
 */

import { nextScheduledTick } from './schedule';
import type {
  CheckIn,
  CheckInStatus,
  CreateMonitorInput,
  CronMonitor,
  MonitorStatus,
  OpenRun,
} from './types';

let monoCounter = 0;
function nextId(prefix: string): string {
  monoCounter++;
  return `${prefix}_${Date.now().toString(36)}_${monoCounter.toString(36)}`;
}

export interface MonitorTransition {
  readonly monitorId: string;
  readonly previous: MonitorStatus;
  readonly current: MonitorStatus;
  readonly at: number;
  /** When applicable: the tick or run start associated with the transition. */
  readonly tickAt?: number;
}

export interface CheckInResult {
  readonly checkIn: CheckIn;
  readonly transition?: MonitorTransition;
}

export class MonitorStore {
  private readonly monitors = new Map<string, CronMonitor>();
  private readonly bySlug = new Map<string, string>(); // (projectId+slug) -> monitorId
  private readonly openRuns = new Map<string, OpenRun>(); // checkinId -> run
  private readonly evaluatedTicks = new Map<string, Set<number>>(); // monitorId -> processed ticks
  private readonly checkIns: CheckIn[] = [];

  // ---- monitor lifecycle ----

  createMonitor(input: CreateMonitorInput): CronMonitor {
    const id = input.id ?? nextId('cm');
    const slugKey = `${input.projectId}\u0000${input.slug}`;
    if (this.bySlug.has(slugKey)) {
      throw new RangeError(
        `MonitorStore: slug "${input.slug}" already exists in project "${input.projectId}"`,
      );
    }
    const monitor: CronMonitor = {
      id,
      projectId: input.projectId,
      slug: input.slug,
      schedule: input.schedule,
      maxRuntimeMs: input.maxRuntimeMs,
      checkinMarginMs: input.checkinMarginMs,
      enabled: input.enabled ?? true,
      status: 'never-run',
    };
    this.monitors.set(id, monitor);
    this.bySlug.set(slugKey, id);
    return monitor;
  }

  getMonitor(id: string): CronMonitor | undefined {
    return this.monitors.get(id);
  }

  getMonitorBySlug(projectId: string, slug: string): CronMonitor | undefined {
    const id = this.bySlug.get(`${projectId}\u0000${slug}`);
    return id ? this.monitors.get(id) : undefined;
  }

  setEnabled(id: string, enabled: boolean): CronMonitor {
    const m = this.requireMonitor(id);
    m.enabled = enabled;
    if (!enabled) m.status = 'disabled';
    else if (m.status === 'disabled') m.status = 'never-run';
    return m;
  }

  // ---- check-ins ----

  checkIn(
    monitorId: string,
    status: CheckInStatus,
    receivedAt: number,
    options: {
      readonly tickAt?: number;
      readonly startedAt?: number;
      readonly checkinId?: string;
    } = {},
  ): CheckInResult {
    const m = this.requireMonitor(monitorId);
    let checkin: CheckIn = {
      id: options.checkinId ?? nextId('ci'),
      monitorId,
      status,
      receivedAt,
      ...(options.startedAt !== undefined ? { startedAt: options.startedAt } : {}),
      ...(options.tickAt !== undefined ? { tickAt: options.tickAt } : {}),
    };
    this.checkIns.push(checkin);
    const previous = m.status;
    let transition: MonitorTransition | undefined;

    if (status === 'in_progress') {
      const tick = options.tickAt ?? this.deriveTickFor(m, receivedAt);
      this.openRuns.set(checkin.id, {
        checkinId: checkin.id,
        monitorId,
        startedAt: options.startedAt ?? receivedAt,
        tickAt: tick,
      });
      this.markTickProcessed(monitorId, tick);
    } else {
      const matchingRun = options.checkinId
        ? this.openRuns.get(options.checkinId)
        : this.findRunForMonitor(monitorId);
      const tick = matchingRun?.tickAt ?? options.tickAt ?? this.deriveTickFor(m, receivedAt);
      const startedAt = matchingRun?.startedAt ?? options.startedAt ?? receivedAt;
      const durationMs = receivedAt - startedAt;
      const final: CheckIn = {
        ...checkin,
        startedAt,
        tickAt: tick,
        durationMs,
      };
      // Replace the buffered placeholder with the enriched record.
      this.checkIns[this.checkIns.length - 1] = final;
      checkin = final;

      if (matchingRun) {
        this.openRuns.delete(matchingRun.checkinId);
      }
      this.markTickProcessed(monitorId, tick);
      const newStatus: MonitorStatus = status === 'ok' ? 'ok' : 'error';
      if (newStatus !== previous) {
        transition = Object.freeze({
          monitorId,
          previous,
          current: newStatus,
          at: receivedAt,
          tickAt: tick,
        });
        m.status = newStatus;
        m.lastStatusAt = receivedAt;
      } else {
        m.lastStatusAt = receivedAt;
      }
    }

    m.nextTickAt = nextScheduledTick(m.schedule, receivedAt);
    return Object.freeze({ checkIn: checkin, ...(transition ? { transition } : {}) });
  }

  // ---- evaluation: missed + timeout detection ----

  /**
   * Walk all enabled monitors and detect:
   *   - ticks whose `tickAt + checkinMarginMs < now` and no
   *     `in_progress` has been received → `missed`.
   *   - open runs whose `tickAt + maxRuntimeMs < now` → `timeout`.
   */
  evaluate(now: number): MonitorTransition[] {
    const transitions: MonitorTransition[] = [];

    // Timeouts on open runs.
    for (const run of [...this.openRuns.values()]) {
      const monitor = this.monitors.get(run.monitorId);
      if (!monitor || !monitor.enabled) continue;
      const deadline = run.tickAt + monitor.maxRuntimeMs;
      if (now >= deadline) {
        this.openRuns.delete(run.checkinId);
        const previous = monitor.status;
        if (previous !== 'timeout') {
          monitor.status = 'timeout';
          monitor.lastStatusAt = now;
          transitions.push(
            Object.freeze({
              monitorId: monitor.id,
              previous,
              current: 'timeout',
              at: now,
              tickAt: run.tickAt,
            }),
          );
        }
      }
    }

    // Missed-tick detection.
    for (const monitor of this.monitors.values()) {
      if (!monitor.enabled) continue;
      const ticks = this.ticksMissedFor(monitor, now);
      for (const t of ticks) {
        this.markTickProcessed(monitor.id, t);
        const previous = monitor.status;
        if (previous !== 'missed') {
          monitor.status = 'missed';
          monitor.lastStatusAt = now;
          transitions.push(
            Object.freeze({
              monitorId: monitor.id,
              previous,
              current: 'missed',
              at: now,
              tickAt: t,
            }),
          );
        }
      }
      monitor.nextTickAt = nextScheduledTick(monitor.schedule, now);
    }

    return transitions;
  }

  listCheckIns(monitorId?: string): readonly CheckIn[] {
    if (monitorId === undefined) return Object.freeze([...this.checkIns]);
    return Object.freeze(this.checkIns.filter((c) => c.monitorId === monitorId));
  }

  listMonitors(projectId?: string): readonly CronMonitor[] {
    const all = [...this.monitors.values()];
    return Object.freeze(projectId ? all.filter((m) => m.projectId === projectId) : all);
  }

  // ---- internals ----

  private requireMonitor(id: string): CronMonitor {
    const m = this.monitors.get(id);
    if (!m) throw new RangeError(`MonitorStore: no monitor with id ${id}`);
    return m;
  }

  private deriveTickFor(monitor: CronMonitor, receivedAt: number): number {
    // The tick associated with a check-in is the most recent tick
    // at or before receivedAt.
    return previousTickAt(monitor, receivedAt);
  }

  private markTickProcessed(monitorId: string, tick: number): void {
    const set = this.evaluatedTicks.get(monitorId) ?? new Set<number>();
    set.add(tick);
    this.evaluatedTicks.set(monitorId, set);
  }

  /**
   * Enumerate ticks in `[creationOrLastSeen, now-checkinMargin]`
   * that have no associated check-in and no recorded miss.
   */
  private ticksMissedFor(monitor: CronMonitor, now: number): number[] {
    const set = this.evaluatedTicks.get(monitor.id) ?? new Set<number>();
    const out: number[] = [];
    const deadline = now - monitor.checkinMarginMs;
    // Walk from the last processed tick (or creation), striding forward.
    const startFrom =
      [...set].reduce((max, t) => (t > max ? t : max), 0) || this.firstTickFor(monitor);
    let tick = nextScheduledTick(monitor.schedule, startFrom, false);
    // Bound the walk to avoid pathological loops.
    let safety = 10_000;
    while (tick <= deadline && safety-- > 0) {
      if (!set.has(tick)) out.push(tick);
      tick = nextScheduledTick(monitor.schedule, tick, false);
    }
    return out;
  }

  private firstTickFor(monitor: CronMonitor): number {
    // For brand-new monitors we anchor "first tick" at the schedule's
    // tick at-or-after epoch-of-most-recent-check-in, or at "now-window"
    // if none. We use lastStatusAt if present, else now - 24h as a
    // bounded look-back to avoid producing wildly old ticks.
    const last = monitor.lastStatusAt ?? Date.now() - 24 * 60 * 60 * 1000;
    return last;
  }

  private findRunForMonitor(monitorId: string): OpenRun | undefined {
    for (const r of this.openRuns.values()) {
      if (r.monitorId === monitorId) return r;
    }
    return undefined;
  }
}

function previousTickAt(monitor: CronMonitor, atMs: number): number {
  // Find a tick by stepping forward from a back-stop until past `atMs`,
  // returning the last one ≤ atMs. Bounded to one day of look-back.
  const start = atMs - 24 * 60 * 60 * 1000;
  let prev = start;
  let cursor = nextScheduledTick(monitor.schedule, start, false);
  let safety = 10_000;
  while (cursor <= atMs && safety-- > 0) {
    prev = cursor;
    cursor = nextScheduledTick(monitor.schedule, cursor, false);
  }
  return prev;
}
