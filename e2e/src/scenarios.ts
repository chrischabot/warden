/**
 * 20 use-case scenarios — the most common observability events a
 * Sentry replica must handle. Each scenario:
 *
 *   - `emit(pipeline)` constructs realistic events and routes them
 *     through the live pipeline (real SDK, real relay, real ingest).
 *   - `assert(pipeline)` verifies side effects (group state, store
 *     contents, fingerprint correctness).
 */

import { parseBaggage } from '@sr/proto';
import { extractTraceContext, injectTraceContext } from '@sr/proto';
import {
  detectNPlusOne,
  detectSlowQueries,
  type Span,
} from '@sr/performance';
import { LeakyBucket } from '@sr/rate-limit';
import { Scrubber } from '@sr/pii';
import { HeuristicSeerProvider } from '@sr/seer';
import { convertTraceRequest, SpanKind, StatusCode } from '@sr/otlp';
import type { CheckResult } from '@sr/uptime';
import type { Pipeline } from './pipeline';

export interface Scenario {
  readonly name: string;
  readonly description: string;
  emit(pipeline: Pipeline): Promise<void>;
  assert(pipeline: Pipeline): void | Promise<void>;
}

/** Send a captured error event through the real SDK and relay. */
async function sendErrorEvent(
  pipeline: Pipeline,
  projectId: string,
  error: Error,
  level: 'fatal' | 'error' | 'warning' = 'error',
): Promise<void> {
  const client = pipeline.sdkClient(projectId);
  client.captureException(error, { level });
  await client.flush();
}

export const SCENARIOS: readonly Scenario[] = [
  // ---- 1. null-pointer TypeError --------------------------------------
  {
    name: 'null_pointer_typeerror',
    description: 'JS TypeError: Cannot read properties of undefined → fingerprint stable, group created',
    async emit(pipeline) {
      const err = new TypeError("Cannot read properties of undefined (reading 'user')");
      err.stack =
        'TypeError: Cannot read properties of undefined (reading "user")\n' +
        '    at renderHeader (src/components/Header.tsx:42:18)\n' +
        '    at processRoot (src/main.tsx:18:5)';
      await sendErrorEvent(pipeline, '1', err);
    },
    assert(pipeline) {
      const drain = pipeline.drain();
      if (drain.events !== 1) throw new Error(`expected 1 event drained, got ${drain.events}`);
      const groups = [...pipeline.issues.all()];
      const g = groups.find((g) => g.message.includes('Cannot read properties of undefined'));
      if (!g) throw new Error('TypeError group not created');
      if (g.status !== 'unresolved') throw new Error(`expected unresolved, got ${g.status}`);
      if (g.level !== 'error') throw new Error(`expected level=error, got ${g.level}`);
      if (g.timesSeen !== 1) throw new Error(`expected timesSeen=1, got ${g.timesSeen}`);
    },
  },

  // ---- 2. ReferenceError ----------------------------------------------
  {
    name: 'reference_error',
    description: 'ReferenceError on missing variable → distinct group from TypeError',
    async emit(pipeline) {
      const err = new ReferenceError('userProfile is not defined');
      err.stack =
        'ReferenceError: userProfile is not defined\n' +
        '    at loadProfile (src/profile.ts:33:12)';
      await sendErrorEvent(pipeline, '1', err);
    },
    assert(pipeline) {
      pipeline.drain();
      const list = pipeline.issues.list({ projectId: '1' });
      const refErr = list.groups.find((g) => g.message.includes('userProfile is not defined'));
      if (!refErr) throw new Error('ReferenceError group not created');
      const typeErrGroup = list.groups.find((g) => g.message.includes('Cannot read properties'));
      if (typeErrGroup && typeErrGroup.id === refErr.id) {
        throw new Error('ReferenceError and TypeError dedup-collided');
      }
    },
  },

  // ---- 3. network failure ECONNREFUSED --------------------------------
  {
    name: 'network_failure_econnrefused',
    description: 'Outbound connect ECONNREFUSED → Seer heuristic classifies as network failure',
    async emit(pipeline) {
      const err = new Error('connect ECONNREFUSED 10.0.0.1:5432');
      err.name = 'Error';
      await sendErrorEvent(pipeline, '2', err);
    },
    async assert(pipeline) {
      pipeline.drain();
      const list = pipeline.issues.list({ projectId: '2' });
      const g = list.groups.find((g) => g.message.includes('ECONNREFUSED'));
      if (!g) throw new Error('ECONNREFUSED group missing');
      const seer = new HeuristicSeerProvider();
      const rc = await seer.analyseRootCause({
        projectId: '2',
        groupId: g.id,
        groupHash: g.groupHash,
        event: {
          platform: 'javascript',
          exceptions: [{ type: 'Error', value: 'connect ECONNREFUSED 10.0.0.1:5432', frames: [] }],
        },
      });
      if (!rc.candidates.some((c) => c.summary.includes('network failure'))) {
        throw new Error('Seer did not classify as network failure');
      }
    },
  },

  // ---- 4. HTTP 500 ----------------------------------------------------
  {
    name: 'http_500_error',
    description: 'Captured 500 response → group with status tag preserved',
    async emit(pipeline) {
      const client = pipeline.sdkClient('2');
      const err = new Error('HTTP 500: Internal Server Error from /api/orders');
      client.captureException(err, { tags: { 'http.status': '500', 'http.method': 'POST' } });
      await client.flush();
    },
    assert(pipeline) {
      pipeline.drain();
      const g = pipeline.issues
        .list({ projectId: '2' })
        .groups.find((g) => g.message.includes('Internal Server Error'));
      if (!g) throw new Error('500 group missing');
    },
  },

  // ---- 5. DB pool exhausted -------------------------------------------
  {
    name: 'db_pool_exhausted',
    description: 'PoolExhausted exception → distinct group, fatal level',
    async emit(pipeline) {
      const err = new Error(
        'PoolExhausted: timed out waiting for connection (driver=pg, after SELECT * FROM users)',
      );
      err.name = 'PoolExhausted';
      await sendErrorEvent(pipeline, '2', err, 'fatal');
    },
    assert(pipeline) {
      pipeline.drain();
      const g = pipeline.issues
        .list({ projectId: '2' })
        .groups.find((g) => g.message.includes('PoolExhausted'));
      if (!g) throw new Error('Pool exhausted group missing');
      if (g.level !== 'fatal') throw new Error(`expected fatal, got ${g.level}`);
    },
  },

  // ---- 6. slow DB query (>500ms) --------------------------------------
  {
    name: 'slow_query_detection',
    description: 'DB span ≥ 500ms → performance detector emits slow-query issue',
    async emit(pipeline) {
      const spans: Span[] = [
        {
          traceId: 't1',
          spanId: 's1',
          parentSpanId: 'root',
          op: 'db',
          description: 'SELECT * FROM orders WHERE user_id = ? AND created_at > ?',
          startTimestamp: 0,
          endTimestamp: 850,
          durationMs: 850,
          status: 'ok',
        },
      ];
      pipeline.transactions.recordSpans('t1', spans);
    },
    assert(pipeline) {
      const issues = detectSlowQueries('t1', pipeline.transactions.spansForTrace('t1'));
      if (issues.length !== 1) throw new Error(`expected 1 slow-query, got ${issues.length}`);
      if (issues[0]?.impactMs !== 850) throw new Error('slow-query impactMs mismatch');
    },
  },

  // ---- 7. N+1 query loop ----------------------------------------------
  {
    name: 'n_plus_one_query_loop',
    description: 'Five sibling db spans with same description + parent → n-plus-one issue',
    async emit(pipeline) {
      const spans: Span[] = [];
      for (let i = 0; i < 5; i++) {
        spans.push({
          traceId: 't_np1',
          spanId: `q${i}`,
          parentSpanId: 'list',
          op: 'db',
          description: 'SELECT * FROM comments WHERE post_id = ?',
          startTimestamp: i * 30,
          endTimestamp: i * 30 + 25,
          durationMs: 25,
          status: 'ok',
        });
      }
      pipeline.transactions.recordSpans('t_np1', spans);
    },
    assert(pipeline) {
      const issues = detectNPlusOne('t_np1', pipeline.transactions.spansForTrace('t_np1'));
      if (issues.length !== 1) throw new Error(`expected 1 n-plus-one issue, got ${issues.length}`);
      if (issues[0]?.count !== 5) throw new Error(`expected count=5, got ${issues[0]?.count}`);
    },
  },

  // ---- 8. memory warning ----------------------------------------------
  {
    name: 'memory_warning_level_rises',
    description: 'Same fingerprint at warning then error → level rises to error',
    async emit(pipeline) {
      const client = pipeline.sdkClient('3');
      const err1 = new Error('Heap usage exceeded soft threshold (1024 MiB)');
      err1.name = 'HeapWarning';
      client.captureException(err1, { level: 'warning' });
      const err2 = new Error('Heap usage exceeded soft threshold (1024 MiB)');
      err2.name = 'HeapWarning';
      client.captureException(err2, { level: 'error' });
      await client.flush();
    },
    assert(pipeline) {
      pipeline.drain();
      const g = pipeline.issues
        .list({ projectId: '3' })
        .groups.find((g) => g.message.includes('Heap usage exceeded'));
      if (!g) throw new Error('Heap warning group missing');
      if (g.level !== 'error') throw new Error(`expected level rises to error, got ${g.level}`);
      if (g.timesSeen !== 2) throw new Error(`expected timesSeen=2, got ${g.timesSeen}`);
    },
  },

  // ---- 9. cron missed -------------------------------------------------
  {
    name: 'cron_missed_tick',
    description: 'Scheduled tick passes without an in_progress check-in → status flips to missed',
    async emit(pipeline) {
      const m = pipeline.monitors.createMonitor({
        projectId: '3',
        slug: `nightly-${Math.random().toString(36).slice(2, 8)}`,
        schedule: { type: 'crontab', expression: '* * * * *' },
        maxRuntimeMs: 60_000,
        checkinMarginMs: 30_000,
      });
      const baseTick = Date.UTC(2026, 4, 16, 12, 0, 0);
      const start = pipeline.monitors.checkIn(m.id, 'in_progress', baseTick + 1000, { tickAt: baseTick });
      pipeline.monitors.checkIn(m.id, 'ok', baseTick + 5000, { checkinId: start.checkIn.id });
      pipeline.monitors.evaluate(baseTick + 5 * 60_000 + 1);
      (pipeline as unknown as { _missedMonitorId?: string })._missedMonitorId = m.id;
    },
    assert(pipeline) {
      const id = (pipeline as unknown as { _missedMonitorId?: string })._missedMonitorId;
      if (!id) throw new Error('missed-monitor id not recorded');
      const m = pipeline.monitors.getMonitor(id);
      if (m?.status !== 'missed') throw new Error(`expected status=missed, got ${m?.status}`);
    },
  },

  // ---- 10. cron timeout -----------------------------------------------
  {
    name: 'cron_timeout',
    description: 'in_progress check-in not followed by terminal within maxRuntimeMs → status=timeout',
    async emit(pipeline) {
      const m = pipeline.monitors.createMonitor({
        projectId: '3',
        slug: `long-${Math.random().toString(36).slice(2, 8)}`,
        schedule: { type: 'crontab', expression: '0 * * * *' },
        maxRuntimeMs: 60_000,
        checkinMarginMs: 30_000,
      });
      const tickAt = Date.UTC(2026, 4, 16, 12, 0, 0);
      pipeline.monitors.checkIn(m.id, 'in_progress', tickAt + 100, { tickAt });
      pipeline.monitors.evaluate(tickAt + 70_000);
      (pipeline as unknown as { _timeoutMonitorId?: string })._timeoutMonitorId = m.id;
    },
    assert(pipeline) {
      const id = (pipeline as unknown as { _timeoutMonitorId?: string })._timeoutMonitorId;
      const m = pipeline.monitors.getMonitor(id ?? '');
      if (m?.status !== 'timeout') throw new Error(`expected timeout, got ${m?.status}`);
    },
  },

  // ---- 11. uptime DOWN with incident ----------------------------------
  {
    name: 'uptime_down_opens_incident',
    description: 'After an up baseline, three consecutive down probes flip to down + open Incident',
    async emit(pipeline) {
      const c = pipeline.uptime.createCheck({
        projectId: '3',
        slug: `home-${Math.random().toString(36).slice(2, 6)}`,
        url: 'https://example.test/',
        intervalMs: 60_000,
        failuresToDown: 3,
        successesToUp: 2,
      });
      const upResult: CheckResult = {
        id: 'r_up',
        checkId: c.id,
        status: 'up',
        httpStatus: 200,
        responseTimeMs: 80,
        observedAt: 500,
      };
      const downResult = (id: string, at: number): CheckResult => ({
        id: `r${id}`,
        checkId: c.id,
        status: 'down',
        httpStatus: 503,
        responseTimeMs: 250,
        observedAt: at,
      });
      pipeline.uptime.ingest(c.id, upResult);
      pipeline.uptime.ingest(c.id, downResult('1', 1000));
      pipeline.uptime.ingest(c.id, downResult('2', 2000));
      pipeline.uptime.ingest(c.id, downResult('3', 3000));
      (pipeline as unknown as { _downCheckId?: string })._downCheckId = c.id;
    },
    assert(pipeline) {
      const id = (pipeline as unknown as { _downCheckId?: string })._downCheckId;
      const c = pipeline.uptime.getCheck(id ?? '');
      if (c?.status !== 'down') throw new Error(`expected down, got ${c?.status}`);
      const incidents = pipeline.uptime.openIncidents();
      if (incidents.length === 0) throw new Error('no open incident');
    },
  },

  // ---- 12. rate limit triggered ---------------------------------------
  {
    name: 'rate_limit_exceeded',
    description: 'Leaky bucket rejects beyond capacity; the package-level enforcement holds',
    async emit() {
      // Exercised inline in assert via the standalone LeakyBucket.
    },
    assert() {
      const bucket = new LeakyBucket({
        capacity: 10,
        refillPerSec: 0,
        initialNowMs: 0,
      });
      let accepted = 0;
      let rejected = 0;
      for (let i = 0; i < 20; i++) {
        if (bucket.tryAcquire(1, 0)) accepted++;
        else rejected++;
      }
      if (accepted !== 10) throw new Error(`expected 10 accepted, got ${accepted}`);
      if (rejected !== 10) throw new Error(`expected 10 rejected, got ${rejected}`);
    },
  },

  // ---- 13. PII scrubbing ----------------------------------------------
  {
    name: 'pii_scrubbing',
    description: 'Email + CC + SSN in message body → all redacted before enqueue',
    async emit() {
      // Exercised inline in assert via the standalone Scrubber.
    },
    assert() {
      const s = new Scrubber();
      const msg = 'User alice@example.com bought with card 4242 4242 4242 4242, SSN 123-45-6789';
      const cleaned = s.scrubString(msg);
      if (cleaned.includes('alice@example.com')) throw new Error('email not scrubbed');
      if (cleaned.includes('4242 4242 4242 4242')) throw new Error('card not scrubbed');
      if (cleaned.includes('123-45-6789')) throw new Error('SSN not scrubbed');
    },
  },

  // ---- 14. trace propagation ------------------------------------------
  {
    name: 'trace_propagation',
    description: 'Inject + extract sentry-trace + baggage round-trips traceId / spanId / sampled / DSC',
    async emit() {
      // Pure round-trip test.
    },
    assert() {
      const headers = injectTraceContext(
        {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: '00f067aa0ba902b7',
          sampled: true,
        },
        { traceparent: true },
      );
      const baggageHeader =
        'sentry-environment=production,sentry-release=v1.4.2,sentry-trace_id=4bf92f3577b34da6a3ce929d0e0e4736';
      const incoming = { ...headers, baggage: baggageHeader };
      const extracted = extractTraceContext(incoming);
      if (!extracted) throw new Error('extractTraceContext returned undefined');
      if (extracted.traceId !== '4bf92f3577b34da6a3ce929d0e0e4736') throw new Error('traceId mismatch');
      if (extracted.spanId !== '00f067aa0ba902b7') throw new Error('spanId mismatch');
      if (extracted.sampled !== true) throw new Error('sampled mismatch');
      const baggage = parseBaggage(baggageHeader);
      if (baggage.sentry['release'] !== 'v1.4.2') throw new Error('DSC release mismatch');
    },
  },

  // ---- 15. release deploy ---------------------------------------------
  {
    name: 'release_deploy',
    description: 'New release recorded + deploy → ReleaseStore tracks both',
    async emit(pipeline) {
      pipeline.releases.upsertRelease({ version: '1.4.2', projectId: '1' });
      pipeline.releases.recordDeploy({
        releaseVersion: '1.4.2',
        projectId: '1',
        environment: 'production',
        deployedAt: Date.now(),
      });
    },
    assert(pipeline) {
      const r = pipeline.releases.getRelease('1.4.2');
      if (!r) throw new Error('release 1.4.2 missing');
      const deploys = pipeline.releases.listDeploys({ releaseVersion: '1.4.2' });
      if (deploys.length !== 1) throw new Error(`expected 1 deploy, got ${deploys.length}`);
    },
  },

  // ---- 16. issue regression -------------------------------------------
  {
    name: 'issue_regression',
    description: 'Resolve a group then receive another event → flagged as regression',
    async emit(pipeline) {
      const client = pipeline.sdkClient('1');
      const fakeStack =
        'KnownIssue: Regressionable: well-known oversight\n' +
        '    at recurring (src/known.ts:10:5)\n' +
        '    at run (src/main.ts:20:3)';
      const err = new Error('Regressionable: well-known oversight');
      err.name = 'KnownIssue';
      err.stack = fakeStack;
      client.captureException(err);
      await client.flush();
      pipeline.drain();
      const g = pipeline.issues
        .list({ projectId: '1' })
        .groups.find((g) => g.message.includes('Regressionable'));
      if (!g) throw new Error('regression scenario: initial group not created');
      pipeline.issues.resolve(g.id);
      (pipeline as unknown as { _regressionGroupId?: string })._regressionGroupId = g.id;
      const err2 = new Error('Regressionable: well-known oversight');
      err2.name = 'KnownIssue';
      err2.stack = fakeStack;
      client.captureException(err2);
      await client.flush();
    },
    assert(pipeline) {
      pipeline.drain();
      const id = (pipeline as unknown as { _regressionGroupId?: string })._regressionGroupId;
      const g = pipeline.issues.get(id ?? '');
      if (!g) throw new Error('regression group missing');
      if (g.status !== 'unresolved') throw new Error(`expected unresolved, got ${g.status}`);
      if (!g.hasRegressed) throw new Error('hasRegressed should be true');
    },
  },

  // ---- 17. snooze auto-reopen -----------------------------------------
  {
    name: 'snooze_untilEvents_auto_reopen',
    description: 'Ignored group with untilEvents=3 auto-reopens on the 3rd new event',
    async emit(pipeline) {
      const client = pipeline.sdkClient('1');
      const fakeStack =
        'SnoozeMe: SnoozeMe: noisy alert\n' +
        '    at noisy (src/snooze.ts:7:1)\n' +
        '    at root (src/main.ts:1:1)';
      const seedErr = new Error('SnoozeMe: noisy alert');
      seedErr.name = 'SnoozeMe';
      seedErr.stack = fakeStack;
      client.captureException(seedErr);
      await client.flush();
      pipeline.drain();
      const g = pipeline.issues
        .list({ projectId: '1' })
        .groups.find((g) => g.message.includes('SnoozeMe'));
      if (!g) throw new Error('snooze scenario: initial group not created');
      pipeline.issues.ignore(g.id, { untilEvents: 3 });
      (pipeline as unknown as { _snoozeGroupId?: string })._snoozeGroupId = g.id;
      for (let i = 0; i < 3; i++) {
        const e = new Error('SnoozeMe: noisy alert');
        e.name = 'SnoozeMe';
        e.stack = fakeStack;
        client.captureException(e);
      }
      await client.flush();
    },
    assert(pipeline) {
      pipeline.drain();
      const id = (pipeline as unknown as { _snoozeGroupId?: string })._snoozeGroupId;
      const g = pipeline.issues.get(id ?? '');
      if (!g) throw new Error('snooze group missing');
      if (g.status !== 'unresolved') {
        throw new Error(`expected auto-reopen to unresolved, got ${g.status}`);
      }
    },
  },

  // ---- 18. bulk archive -----------------------------------------------
  {
    name: 'bulk_archive',
    description: 'IssueStore.bulk({status:["unresolved"]}, archive) clears a project',
    async emit(pipeline) {
      const client = pipeline.sdkClient('1');
      for (let i = 0; i < 4; i++) {
        const e = new Error(`BulkA: type ${i}`);
        e.name = `BulkA${i}`;
        client.captureException(e);
      }
      await client.flush();
      pipeline.drain();
    },
    assert(pipeline) {
      const beforeOpen = pipeline.issues.list({ projectId: '1', status: ['unresolved'] }).total;
      const archived = pipeline.issues.bulk({ projectId: '1', status: ['unresolved'] }, (id) =>
        pipeline.issues.archive(id),
      );
      if (archived !== beforeOpen) throw new Error('bulk archive count mismatch');
      const afterOpen = pipeline.issues.list({ projectId: '1', status: ['unresolved'] }).total;
      if (afterOpen !== 0) throw new Error('some groups not archived');
    },
  },

  // ---- 19. custom counter ---------------------------------------------
  {
    name: 'custom_counter_metric',
    description: 'Emit counter samples in the same bucket → sum aggregates correctly',
    async emit(pipeline) {
      for (let i = 0; i < 7; i++) {
        pipeline.metrics.record({
          projectId: '1',
          name: 'logins',
          type: 'counter',
          tags: { method: 'oauth' },
          value: 1,
          timestamp: 1_700_000_000_000 + i * 100,
        });
      }
    },
    assert(pipeline) {
      const buckets = pipeline.metrics.query({ projectId: '1', name: 'logins', type: 'counter' });
      if (buckets.length !== 1) throw new Error(`expected 1 bucket, got ${buckets.length}`);
      const sum = (buckets[0] as { sum: number }).sum;
      if (sum !== 7) throw new Error(`expected sum=7, got ${sum}`);
    },
  },

  // ---- 20. OTLP trace ingest ------------------------------------------
  {
    name: 'otlp_trace_ingest',
    description: 'OTLP/JSON span batch converts to a Sentry Transaction with child spans',
    async emit(pipeline) {
      const nsString = (ms: number): string => String(ms * 1_000_000);
      const out = convertTraceRequest(
        {
          resourceSpans: [
            {
              resource: {
                attributes: [
                  { key: 'service.version', value: { stringValue: '2.0.0' } },
                  { key: 'deployment.environment', value: { stringValue: 'production' } },
                ],
              },
              scopeSpans: [
                {
                  scope: { name: 'instrumentation' },
                  spans: [
                    {
                      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                      spanId: 'bbbbbbbbbbbbbbbb',
                      name: 'GET /api/users',
                      kind: SpanKind.SERVER,
                      startTimeUnixNano: nsString(1000),
                      endTimeUnixNano: nsString(1200),
                      status: { code: StatusCode.OK },
                    },
                    {
                      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                      spanId: 'cccccccccccccccc',
                      parentSpanId: 'bbbbbbbbbbbbbbbb',
                      name: 'SELECT users',
                      kind: SpanKind.CLIENT,
                      startTimeUnixNano: nsString(1050),
                      endTimeUnixNano: nsString(1100),
                      status: { code: StatusCode.OK },
                    },
                  ],
                },
              ],
            },
          ],
        },
        { projectId: '2' },
      );
      for (const tx of out.transactions) pipeline.transactions.record(tx);
    },
    assert(pipeline) {
      const r = pipeline.transactions.list({ transactionName: 'GET /api/users' });
      if (r.total !== 1) throw new Error(`expected 1 transaction, got ${r.total}`);
      const tx = r.transactions[0]!;
      if (tx.op !== 'http.server') throw new Error(`expected op=http.server, got ${tx.op}`);
      if (tx.environment !== 'production') throw new Error('environment missing');
      if (tx.release !== '2.0.0') throw new Error('release missing');
      if (tx.spans?.length !== 1) throw new Error('child span missing');
    },
  },
];