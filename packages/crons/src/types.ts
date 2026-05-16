/**
 * Cron monitor types per spec §5.6.
 *
 * A `CronMonitor` declares a `schedule` (crontab string, list of
 * specific times, or an interval), an expected `maxRuntimeMs`,
 * and a `checkinMargin` (how long after a tick before we declare
 * "missed").
 *
 * The lifecycle of a single scheduled run:
 *
 *   on a tick T0:
 *     - the monitor expects an `in_progress` check-in within
 *       `checkinMargin`. If none arrives, mark `missed` for T0.
 *     - if `in_progress` arrives, the monitor expects a terminal
 *       `ok` or `error` within `maxRuntimeMs` after T0. If none
 *       arrives by then, mark `timeout`.
 *     - `ok` → state becomes `ok`; `error` → `error`.
 *
 * Multiple runs can be in-flight simultaneously (e.g. if the
 * schedule fires every minute but the job sometimes takes 90s),
 * each tracked by its own checkin ID.
 */

export type MonitorStatus = 'never-run' | 'ok' | 'error' | 'missed' | 'timeout' | 'disabled';

export type CheckInStatus = 'in_progress' | 'ok' | 'error';

export interface ScheduleCrontab {
  readonly type: 'crontab';
  readonly expression: string;
  readonly timezone?: string;
}

export interface ScheduleInterval {
  readonly type: 'interval';
  readonly intervalMs: number;
  /** Optional anchor for tick computation. Default: monitor creation. */
  readonly anchorAt?: number;
}

export type Schedule = ScheduleCrontab | ScheduleInterval;

export interface CronMonitor {
  readonly id: string;
  readonly projectId: string;
  readonly slug: string;
  readonly schedule: Schedule;
  /** Expected upper bound for run duration, ms. */
  readonly maxRuntimeMs: number;
  /** How long after a scheduled tick before declaring `missed`, ms. */
  readonly checkinMarginMs: number;
  enabled: boolean;
  status: MonitorStatus;
  /** Last terminal status (ok | error | missed | timeout) timestamp. */
  lastStatusAt?: number;
  /** Wall-clock of the next scheduled tick. */
  nextTickAt?: number;
}

export interface CheckIn {
  readonly id: string;
  readonly monitorId: string;
  readonly status: CheckInStatus;
  readonly receivedAt: number;
  /** Wall-clock at which the run started; defaults to `receivedAt` for `in_progress`. */
  readonly startedAt?: number;
  /** Tick this check-in is associated with, if known. */
  readonly tickAt?: number;
  /** Run duration in ms; only populated for terminal statuses. */
  readonly durationMs?: number;
}

export interface CreateMonitorInput {
  readonly id?: string;
  readonly projectId: string;
  readonly slug: string;
  readonly schedule: Schedule;
  readonly maxRuntimeMs: number;
  readonly checkinMarginMs: number;
  readonly enabled?: boolean;
}

/**
 * Internal: an open run between an `in_progress` check-in and its
 * matching terminal check-in.
 */
export interface OpenRun {
  readonly checkinId: string;
  readonly monitorId: string;
  readonly startedAt: number;
  readonly tickAt: number;
}
