export type IssueLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';
export type IssueStatus = 'unresolved' | 'resolved' | 'ignored' | 'archived';

export interface IssueView {
  readonly id: string;
  readonly shortId: string;
  readonly title: string;
  readonly culprit: string;
  readonly level: IssueLevel;
  readonly status: IssueStatus;
  readonly eventsCount: number;
  readonly usersAffected: number;
  readonly lastSeen: string;
  readonly project: string;
  readonly isUnhandled: boolean;
}

export interface TransactionView {
  readonly id: string;
  readonly name: string;
  readonly op: string;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly throughputPerMin: number;
  readonly failureRate: number;
  readonly apdex: number;
}

export type MonitorStatus = 'ok' | 'error' | 'missed' | 'timeout' | 'disabled' | 'never-run';

export interface CronMonitorView {
  readonly id: string;
  readonly slug: string;
  readonly schedule: string;
  readonly status: MonitorStatus;
  readonly lastRunAt: string;
  readonly lastRunDurationMs?: number;
  readonly nextRunAt: string;
}

export type UptimeStatus = 'up' | 'degraded' | 'down' | 'unknown';

export interface UptimeCheckView {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly status: UptimeStatus;
  readonly uptimePct: number;
  readonly responseTimeMs: number;
  readonly lastCheckedAt: string;
}

export interface ReleaseView {
  readonly version: string;
  readonly deployedAt: string;
  readonly environments: readonly string[];
  readonly commitCount: number;
  readonly newIssues: number;
  readonly crashFreeUsers: number;
}