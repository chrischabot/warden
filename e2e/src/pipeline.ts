/**
 * Pipeline: the full sentry-replica system in one object.
 *
 * Wires:
 *   - all the in-memory stores (IssueStore, TransactionStore, LogStore,
 *     MetricStore, ReplayStore, ProfileStore, MonitorStore, UptimeStore,
 *     ReleaseStore, AdminStore, IssueAlertEvaluator, MetricAlertEvaluator)
 *   - the relay handler (with optional rate-limit, sampler, scrubber, outcomes)
 *   - an in-memory queue
 *   - a `drain()` method that simulates the ingest worker:
 *       parse each queued envelope item → route to the right store →
 *       fingerprint events → record in IssueStore.
 *
 * For HTTP-style scenarios, `sdkClient(projectId)` returns a real
 * `@sr/sdk-javascript` Client whose transport pumps directly into the
 * relay handler — same code path the production SDK uses, no socket.
 */

import { AdminStore } from '@sr/admin';
import { IssueAlertEvaluator, MetricAlertEvaluator } from '@sr/alerts';
import { createRelay, type RelayHandler } from '@sr/app-relay';
import { MonitorStore } from '@sr/crons';
import { MetricStore } from '@sr/custom-metrics';
import { fingerprintEvent } from '@sr/grouping';
import { IssueStore, type GroupType, type IssueEvent, type SentryLevel } from '@sr/issues';
import { LogStore, type LogEvent, type LogLevel } from '@sr/logs';
import { BufferedOutcomeRecorder } from '@sr/outcomes';
import { Scrubber } from '@sr/pii';
import { ProfileStore, type Profile } from '@sr/profiling';
import { TransactionStore, type Span, type Transaction } from '@sr/performance';
import { RateLimiter, type RateLimitRule } from '@sr/rate-limit';
import { ReleaseStore } from '@sr/releases';
import { ReplayStore } from '@sr/replays';
import { Sampler, type SamplingRule } from '@sr/sampling';
import { Client, type Transport } from '@sr/sdk-javascript';
import { HeuristicSeerProvider, SeerService } from '@sr/seer';
import { UptimeStore } from '@sr/uptime';
import { InMemoryQueue } from './in-memory-queue';
import { InProcessTransport } from './in-process-transport';

const utf8 = new TextDecoder('utf-8', { fatal: false });

export interface PipelineOptions {
  readonly enableRateLimit?: boolean;
  readonly enableSampling?: boolean;
  readonly enablePiiScrub?: boolean;
  /** Custom rate-limit rules; defaults to a single permissive bucket. */
  readonly rateLimitRules?: readonly RateLimitRule[];
  /** Custom sampling rules; defaults to single 100% rule. */
  readonly samplingRules?: readonly SamplingRule[];
}

export interface DrainStats {
  readonly events: number;
  readonly transactions: number;
  readonly logs: number;
  readonly metrics: number;
  readonly sessions: number;
  readonly attachments: number;
  readonly profiles: number;
  readonly replaySegments: number;
  readonly checkIns: number;
  readonly userReports: number;
  readonly unknown: number;
}

export class Pipeline {
  // Stores.
  readonly issues = new IssueStore({ projectSlugs: { '1': 'web', '2': 'api', '3': 'worker' } });
  readonly transactions = new TransactionStore();
  readonly logs = new LogStore({ capacity: 1_000_000 });
  readonly metrics = new MetricStore({ bucketMs: 10_000 });
  readonly replays = new ReplayStore();
  readonly profiles = new ProfileStore();
  readonly monitors = new MonitorStore();
  readonly uptime = new UptimeStore();
  readonly releases = new ReleaseStore();
  readonly admin = new AdminStore();
  readonly issueAlerts = new IssueAlertEvaluator();
  readonly metricAlerts = new MetricAlertEvaluator();
  readonly seer = new SeerService(new HeuristicSeerProvider());
  readonly outcomes = new BufferedOutcomeRecorder();

  // Pipeline parts.
  readonly queue = new InMemoryQueue();
  readonly relay: RelayHandler;
  readonly scrubber: Scrubber;
  readonly rateLimiter?: RateLimiter;
  readonly sampler?: Sampler;
  readonly transports: InProcessTransport[] = [];

  // Diagnostics.
  private _sessionsRecorded = 0;
  private _attachmentsRecorded = 0;
  private _userReportsRecorded = 0;
  private _checkInsRecorded = 0;
  private _unknownRecorded = 0;

  constructor(options: PipelineOptions = {}) {
    this.scrubber = new Scrubber();
    if (options.enableRateLimit) {
      this.rateLimiter = new RateLimiter({
        rules: options.rateLimitRules ?? [
          { projectId: '*', dataCategory: '*', capacity: 1_000_000, refillPerSec: 100_000 },
        ],
      });
    }
    if (options.enableSampling) {
      this.sampler = new Sampler(options.samplingRules ?? [], { defaultSampleRate: 1.0 });
    }
    this.relay = createRelay({
      queue: this.queue,
      ...(this.rateLimiter ? { rateLimiter: this.rateLimiter } : {}),
      ...(this.sampler ? { sampler: this.sampler } : {}),
      ...(options.enablePiiScrub ? { scrubber: this.scrubber } : {}),
      outcomes: this.outcomes,
    });
  }

  /** SDK Client wired to the relay; one per project_id in tests. */
  sdkClient(projectId: string, options: { release?: string; environment?: string } = {}): Client {
    const url = `http://relay.local/api/${projectId}/envelope/`;
    const dsn = `https://pubkey${projectId}@relay.local/${projectId}`;
    const transport = new InProcessTransport(this.relay, url);
    this.transports.push(transport);
    return new Client({
      dsn,
      transport: transport as Transport,
      ...(options.release !== undefined ? { release: options.release } : {}),
      ...(options.environment !== undefined ? { environment: options.environment } : {}),
    });
  }

  /** Wait for every SDK transport to flush its in-flight sends. */
  async flushAllTransports(): Promise<void> {
    for (const t of this.transports) await t.flush();
  }

  /**
   * Process every queued envelope item: parse the wire form, route
   * by item type, and update the appropriate store. Returns counts.
   */
  drain(): DrainStats {
    const stats = {
      events: 0,
      transactions: 0,
      logs: 0,
      metrics: 0,
      sessions: 0,
      attachments: 0,
      profiles: 0,
      replaySegments: 0,
      checkIns: 0,
      userReports: 0,
      unknown: 0,
    };
    const drained = this.queue.drainAll();
    for (const [topic, items] of drained) {
      const [projectId, itemType] = topic.split(':') as [string, string];
      for (const wire of items) {
        const lf = wire.indexOf(0x0a);
        if (lf < 0) continue;
        let header: Record<string, unknown>;
        let payload: Uint8Array;
        try {
          header = JSON.parse(utf8.decode(wire.subarray(0, lf))) as Record<string, unknown>;
          payload = wire.subarray(lf + 1);
        } catch {
          stats.unknown++;
          continue;
        }
        switch (itemType) {
          case 'event':
            this.routeEvent(projectId, payload);
            stats.events++;
            break;
          case 'transaction':
            this.routeTransaction(projectId, payload);
            stats.transactions++;
            break;
          case 'log':
            this.routeLog(projectId, payload);
            stats.logs++;
            break;
          case 'statsd':
            this.routeMetric(projectId, payload);
            stats.metrics++;
            break;
          case 'session':
          case 'sessions':
            this._sessionsRecorded++;
            stats.sessions++;
            break;
          case 'attachment':
            this._attachmentsRecorded++;
            stats.attachments++;
            break;
          case 'profile':
            this.routeProfile(projectId, payload);
            stats.profiles++;
            break;
          case 'replay_recording':
            this.routeReplaySegment(projectId, payload, header);
            stats.replaySegments++;
            break;
          case 'check_in':
            this.routeCheckIn(projectId, payload);
            this._checkInsRecorded++;
            stats.checkIns++;
            break;
          case 'user_report':
          case 'feedback':
            this._userReportsRecorded++;
            stats.userReports++;
            break;
          default:
            this._unknownRecorded++;
            stats.unknown++;
            break;
        }
      }
    }
    return Object.freeze(stats);
  }

  get sessionsRecorded(): number {
    return this._sessionsRecorded;
  }
  get attachmentsRecorded(): number {
    return this._attachmentsRecorded;
  }
  get userReportsRecorded(): number {
    return this._userReportsRecorded;
  }
  get checkInsRecorded(): number {
    return this._checkInsRecorded;
  }
  get unknownRecorded(): number {
    return this._unknownRecorded;
  }

  // ---- routing internals ----

  private routeEvent(projectId: string, payload: Uint8Array): void {
    let ev: SentryEventJson;
    try {
      ev = JSON.parse(utf8.decode(payload)) as SentryEventJson;
    } catch {
      return;
    }
    const fp = fingerprintEvent({
      event_id: ev.event_id,
      platform: ev.platform ?? 'javascript',
      timestamp: ev.timestamp,
      level: (ev.level as SentryLevel | undefined) ?? 'error',
      ...(ev.message ? { message: ev.message } : {}),
      ...(ev.environment ? { environment: ev.environment } : {}),
      ...(ev.release ? { release: ev.release } : {}),
      ...(ev.exception
        ? {
            exception: {
              values: ev.exception.values.map((v) => ({
                type: v.type,
                value: v.value,
                ...(v.stacktrace ? { stacktrace: v.stacktrace } : {}),
              })),
            },
          }
        : {}),
    });
    const issueEvent: IssueEvent = {
      projectId,
      groupHash: fp.groupHash,
      fingerprint: fp.fingerprint,
      type: 'error',
      level: (ev.level as SentryLevel | undefined) ?? 'error',
      message: ev.exception?.values?.[0]?.value ?? ev.message ?? '(no message)',
      timestamp: Date.parse(ev.timestamp ?? new Date().toISOString()) || Date.now(),
      ...(ev.user?.id ? { userId: ev.user.id } : {}),
      ...(ev.release ? { release: ev.release } : {}),
      isUnhandled: ev.tags?.['handled'] === 'no',
    };
    this.issues.record(issueEvent);
  }

  private routeTransaction(projectId: string, payload: Uint8Array): void {
    try {
      const json = JSON.parse(utf8.decode(payload)) as TransactionJson;
      const tx: Transaction = {
        eventId: json.event_id ?? randomEventId(),
        projectId,
        traceId: json.contexts?.trace?.trace_id ?? 'unknown',
        spanId: json.contexts?.trace?.span_id ?? 'unknown',
        transaction: json.transaction ?? '(unnamed)',
        op: json.contexts?.trace?.op ?? 'operation',
        platform: json.platform ?? 'javascript',
        startTimestamp: (json.start_timestamp ?? 0) * 1000,
        endTimestamp: (json.timestamp ?? 0) * 1000,
        durationMs: ((json.timestamp ?? 0) - (json.start_timestamp ?? 0)) * 1000,
        status: (json.contexts?.trace?.status as Transaction['status']) ?? 'ok',
        ...(json.environment ? { environment: json.environment } : {}),
        ...(json.release ? { release: json.release } : {}),
        ...(Array.isArray(json.spans)
          ? {
              spans: json.spans.map(
                (s): Span => ({
                  traceId: s.trace_id,
                  spanId: s.span_id,
                  ...(s.parent_span_id ? { parentSpanId: s.parent_span_id } : {}),
                  op: s.op,
                  ...(s.description ? { description: s.description } : {}),
                  startTimestamp: s.start_timestamp * 1000,
                  endTimestamp: s.timestamp * 1000,
                  durationMs: (s.timestamp - s.start_timestamp) * 1000,
                  status: (s.status as Span['status']) ?? 'ok',
                }),
              ),
            }
          : {}),
      };
      this.transactions.record(tx);
    } catch {
      // ignore malformed transactions
    }
  }

  private routeLog(projectId: string, payload: Uint8Array): void {
    try {
      const json = JSON.parse(utf8.decode(payload)) as LogJson;
      const log: LogEvent = {
        id: json.id ?? randomEventId(),
        projectId,
        level: (json.level as LogLevel | undefined) ?? 'info',
        message: json.message ?? '',
        timestamp:
          typeof json.timestamp === 'number' ? json.timestamp : Date.parse(json.timestamp ?? '') || Date.now(),
        ...(json.trace_id ? { traceId: json.trace_id } : {}),
      };
      this.logs.append(log);
    } catch {
      // ignore
    }
  }

  private routeMetric(projectId: string, payload: Uint8Array): void {
    // Sentry statsd format: `<name>[@<unit>]:<value>|<type>[|#<tags>][|T<ts>]`
    const text = utf8.decode(payload).trim();
    if (!text) return;
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const parts = line.split('|');
        const first = parts[0];
        const typeToken = parts[1];
        if (!first || !typeToken) continue;
        const colonIdx = first.indexOf(':');
        if (colonIdx < 0) continue;
        const nameAndUnit = first.substring(0, colonIdx);
        const valueStr = first.substring(colonIdx + 1);
        const [name, unit] = nameAndUnit.split('@');
        const value = Number.parseFloat(valueStr);
        if (!Number.isFinite(value)) continue;
        const type = metricTypeFor(typeToken);
        if (!type) continue;

        let timestamp = Date.now();
        let tags: Record<string, string> | undefined;
        for (const tail of parts.slice(2)) {
          if (tail.startsWith('#')) {
            tags = {};
            for (const t of tail.slice(1).split(',')) {
              const [k, v] = t.split(':');
              if (k && v) tags[k] = v;
            }
          } else if (tail.startsWith('T')) {
            const epoch = Number.parseInt(tail.slice(1), 10);
            if (Number.isFinite(epoch)) timestamp = epoch * 1000;
          }
        }

        this.metrics.record({
          projectId,
          name: name ?? 'unnamed',
          type,
          ...(unit ? { unit } : {}),
          ...(tags ? { tags } : {}),
          value,
          timestamp,
        });
      } catch {
        // skip malformed line
      }
    }
  }

  private routeProfile(projectId: string, payload: Uint8Array): void {
    try {
      const json = JSON.parse(utf8.decode(payload)) as ProfileJson;
      const profile: Profile = {
        id: json.event_id ?? randomEventId(),
        projectId,
        platform: json.platform ?? 'javascript',
        ...(json.trace_id ? { traceId: json.trace_id } : {}),
        ...(json.transaction_name ? { transactionName: json.transaction_name } : {}),
        capturedAt: Date.parse(json.timestamp ?? '') || Date.now(),
        durationNs: json.duration_ns ?? 0,
        samplingRateHz: json.sampling_rate_hz ?? 101,
        frames: (json.profile?.frames ?? []).map((f, i) => ({
          id: i,
          ...(f.function ? { function: f.function } : {}),
          ...(f.module ? { module: f.module } : {}),
        })),
        threads: (json.profile?.threads ?? [{ id: 0, name: 'main' }]).map((t) => ({
          id: t.id,
          ...(t.name ? { name: t.name } : {}),
        })),
        samples: (json.profile?.samples ?? []).map((s) => ({
          threadId: s.thread_id ?? 0,
          relativeTsNs: s.relative_ts_ns ?? 0,
          stack: s.stack ?? [],
        })),
      };
      this.profiles.record(profile);
    } catch {
      // ignore
    }
  }

  private routeReplaySegment(
    projectId: string,
    payload: Uint8Array,
    header: Record<string, unknown>,
  ): void {
    const replayId = (header['replay_id'] ?? header['event_id']) as string | undefined;
    if (!replayId) return;
    if (!this.replays.get(replayId)) {
      this.replays.createReplay({ replayId, projectId, startedAt: Date.now() });
    }
    const sequenceId = Number((header['segment_id'] as number | undefined) ?? 0);
    const startTimestamp = Date.now();
    const endTimestamp = startTimestamp + 1000;
    const errorCount = Number((header['error_count'] as number | undefined) ?? 0);
    const url = header['url'] as string | undefined;
    const isFinal = (header['is_final'] as boolean | undefined) === true;
    this.replays.recordSegment({
      replayId,
      sequenceId,
      receivedAt: Date.now(),
      startTimestamp,
      endTimestamp,
      payload,
      ...(url !== undefined ? { url } : {}),
      errorCount,
      ...(isFinal ? { isFinal: true } : {}),
    });
  }

  private routeCheckIn(_projectId: string, payload: Uint8Array): void {
    // The check-in scenario exercises the MonitorStore via direct
    // API in scenarios.ts. Here we just confirm parsability.
    try {
      JSON.parse(utf8.decode(payload));
    } catch {
      // ignore
    }
  }
}

function metricTypeFor(token: string): 'counter' | 'gauge' | 'distribution' | 'set' | undefined {
  switch (token.trim()) {
    case 'c':
      return 'counter';
    case 'g':
      return 'gauge';
    case 'd':
    case 'h':
      return 'distribution';
    case 's':
      return 'set';
    default:
      return undefined;
  }
}

function randomEventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

interface SentryEventJson {
  event_id?: string;
  timestamp?: string;
  platform?: string;
  level?: string;
  message?: string;
  environment?: string;
  release?: string;
  user?: { id?: string };
  tags?: Record<string, string>;
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: Array<{ function?: string; abs_path?: string; lineno?: number; in_app?: boolean }> };
    }>;
  };
}

interface TransactionJson {
  event_id?: string;
  platform?: string;
  environment?: string;
  release?: string;
  transaction?: string;
  start_timestamp?: number;
  timestamp?: number;
  contexts?: {
    trace?: { trace_id: string; span_id: string; op?: string; status?: string };
  };
  spans?: Array<{
    trace_id: string;
    span_id: string;
    parent_span_id?: string;
    op: string;
    description?: string;
    start_timestamp: number;
    timestamp: number;
    status?: string;
  }>;
}

interface LogJson {
  id?: string;
  level?: string;
  message?: string;
  timestamp?: string | number;
  trace_id?: string;
}

interface ProfileJson {
  event_id?: string;
  platform?: string;
  trace_id?: string;
  transaction_name?: string;
  timestamp?: string;
  duration_ns?: number;
  sampling_rate_hz?: number;
  profile?: {
    frames?: Array<{ function?: string; module?: string }>;
    threads?: Array<{ id: number; name?: string }>;
    samples?: Array<{ thread_id?: number; relative_ts_ns?: number; stack?: number[] }>;
  };
}

// Re-export the SentryLevel + GroupType types for scenarios.
export type { SentryLevel, GroupType };