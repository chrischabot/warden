/**
 * Uptime check store.
 *
 * Holds the registered checks, their current status, and an
 * append-only history of probe results + incidents.
 */

import type {
  CheckResult,
  CheckStatus,
  CreateUptimeCheckInput,
  Incident,
  UptimeCheck,
} from './types';

let monoCounter = 0;
function nextId(prefix: string): string {
  monoCounter++;
  return `${prefix}_${Date.now().toString(36)}_${monoCounter.toString(36)}`;
}

export interface IngestOutcome {
  readonly result: CheckResult;
  readonly statusChanged: boolean;
  readonly previousStatus: CheckStatus | 'unknown';
  readonly currentStatus: CheckStatus | 'unknown';
  readonly openedIncident?: Incident;
  readonly closedIncident?: Incident;
}

export interface UptimeSLO {
  readonly checkId: string;
  readonly windowMs: number;
  readonly totalSamples: number;
  readonly upSamples: number;
  readonly downSamples: number;
  readonly degradedSamples: number;
  readonly uptimePct: number;
}

export class UptimeStore {
  private readonly checks = new Map<string, UptimeCheck>();
  private readonly bySlug = new Map<string, string>();
  private readonly results: CheckResult[] = [];
  private readonly incidents = new Map<string, Incident>();

  createCheck(input: CreateUptimeCheckInput): UptimeCheck {
    const id = input.id ?? nextId('uc');
    const slugKey = `${input.projectId}\u0000${input.slug}`;
    if (this.bySlug.has(slugKey)) {
      throw new RangeError(
        `UptimeStore: slug "${input.slug}" already exists in project "${input.projectId}"`,
      );
    }
    const check: UptimeCheck = {
      id,
      projectId: input.projectId,
      slug: input.slug,
      url: input.url,
      method: input.method ?? 'GET',
      ...(input.headers ? { headers: input.headers } : {}),
      intervalMs: input.intervalMs,
      enabled: input.enabled ?? true,
      successCriteria: input.successCriteria ?? {},
      ...(input.failuresToDown !== undefined ? { failuresToDown: input.failuresToDown } : {}),
      ...(input.successesToUp !== undefined ? { successesToUp: input.successesToUp } : {}),
      status: 'unknown',
      consecutiveFails: 0,
      consecutiveSuccesses: 0,
    };
    this.checks.set(id, check);
    this.bySlug.set(slugKey, id);
    return check;
  }

  getCheck(id: string): UptimeCheck | undefined {
    return this.checks.get(id);
  }

  listChecks(projectId?: string): readonly UptimeCheck[] {
    const all = [...this.checks.values()];
    return Object.freeze(projectId ? all.filter((c) => c.projectId === projectId) : all);
  }

  setEnabled(id: string, enabled: boolean): UptimeCheck {
    const c = this.requireCheck(id);
    c.enabled = enabled;
    return c;
  }

  /**
   * Ingest a probe result. Updates streak counters, opens/closes
   * incidents, and returns a structured outcome describing the
   * state change (if any).
   */
  ingest(checkId: string, result: CheckResult): IngestOutcome {
    if (result.checkId !== checkId) {
      throw new RangeError(
        `UptimeStore.ingest: result.checkId "${result.checkId}" does not match parameter "${checkId}"`,
      );
    }
    const check = this.requireCheck(checkId);
    const previousStatus = check.status;
    this.results.push(result);
    check.lastResultAt = result.observedAt;

    const failsToDown = check.failuresToDown ?? 3;
    const succToUp = check.successesToUp ?? 2;

    const isFailure = result.status === 'down';
    if (isFailure) {
      check.consecutiveFails += 1;
      check.consecutiveSuccesses = 0;
    } else {
      check.consecutiveSuccesses += 1;
      check.consecutiveFails = 0;
    }

    let openedIncident: Incident | undefined;
    let closedIncident: Incident | undefined;

    // Down transition.
    if (check.status !== 'down' && check.consecutiveFails >= failsToDown) {
      check.status = 'down';
      const incidentId = nextId('inc');
      const incident: Incident = {
        id: incidentId,
        checkId,
        startedAt: result.observedAt,
        failureCount: 1,
      };
      this.incidents.set(incidentId, incident);
      check.currentIncidentId = incidentId;
      openedIncident = incident;
    } else if (check.status === 'down' && isFailure && check.currentIncidentId) {
      // Accumulate failures into the open incident.
      const inc = this.incidents.get(check.currentIncidentId);
      if (inc) inc.failureCount += 1;
    }

    // Recovery transition.
    if (check.status === 'down' && check.consecutiveSuccesses >= succToUp) {
      check.status = result.status === 'degraded' ? 'degraded' : 'up';
      if (check.currentIncidentId) {
        const inc = this.incidents.get(check.currentIncidentId);
        if (inc) {
          inc.resolvedAt = result.observedAt;
          closedIncident = inc;
        }
        delete check.currentIncidentId;
      }
    } else if (check.status === 'unknown') {
      // Initial state: any single confident sample sets the status.
      check.status = result.status;
    } else if (
      check.status === 'degraded' &&
      result.status === 'up' &&
      check.consecutiveSuccesses >= 1
    ) {
      check.status = 'up';
    } else if (check.status === 'up' && result.status === 'degraded') {
      check.status = 'degraded';
    }

    const currentStatus = check.status;
    return Object.freeze({
      result,
      statusChanged: currentStatus !== previousStatus,
      previousStatus,
      currentStatus,
      ...(openedIncident ? { openedIncident } : {}),
      ...(closedIncident ? { closedIncident } : {}),
    });
  }

  listResults(checkId?: string): readonly CheckResult[] {
    if (checkId === undefined) return Object.freeze([...this.results]);
    return Object.freeze(this.results.filter((r) => r.checkId === checkId));
  }

  listIncidents(checkId?: string): readonly Incident[] {
    const all = [...this.incidents.values()];
    return Object.freeze(checkId === undefined ? all : all.filter((i) => i.checkId === checkId));
  }

  openIncidents(): readonly Incident[] {
    return Object.freeze([...this.incidents.values()].filter((i) => i.resolvedAt === undefined));
  }

  /**
   * Compute uptime SLO over a rolling window ending at `now`.
   * `windowMs` defaults to 24 hours. `degraded` counts as `up`
   * for the percentage (matches Sentry's display).
   */
  slo(checkId: string, now: number, windowMs: number = 24 * 60 * 60_000): UptimeSLO {
    const since = now - windowMs;
    let up = 0;
    let down = 0;
    let degraded = 0;
    for (const r of this.results) {
      if (r.checkId !== checkId) continue;
      if (r.observedAt < since || r.observedAt > now) continue;
      if (r.status === 'up') up += 1;
      else if (r.status === 'down') down += 1;
      else if (r.status === 'degraded') degraded += 1;
    }
    const total = up + down + degraded;
    const uptimePct = total === 0 ? 100 : ((up + degraded) / total) * 100;
    return Object.freeze({
      checkId,
      windowMs,
      totalSamples: total,
      upSamples: up,
      downSamples: down,
      degradedSamples: degraded,
      uptimePct,
    });
  }

  private requireCheck(id: string): UptimeCheck {
    const c = this.checks.get(id);
    if (!c) throw new RangeError(`UptimeStore: no check with id ${id}`);
    return c;
  }
}
