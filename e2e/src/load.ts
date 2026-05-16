/**
 * Load test runner: drives ≥ 20k events through the pipeline and
 * produces a structured report covering throughput, memory deltas,
 * event-loop lag distribution, and accuracy.
 *
 * Event mix (default 20,000 events):
 *
 *   - 16,000 error events (50 distinct fingerprints, 320 per group avg)
 *   - 3,000 transactions (each with 2 child spans)
 *   - 1,000 log events
 *   - Total: 20,000
 *
 * Errors are fed through an actual `@sr/sdk-javascript` Client via
 * the InProcessTransport so the relay handler's parse + enqueue path
 * is exercised on every event. Transactions and logs are sent via
 * pre-built envelopes.
 */

import { encodeEnvelope } from '@sr/proto';
import { formatReport, PerfRecorder, type PerfReport } from './metrics';
import { Pipeline } from './pipeline';

export interface LoadOptions {
  readonly errors?: number;
  readonly transactions?: number;
  readonly logs?: number;
  /** Number of distinct error fingerprints in the burst. */
  readonly distinctErrorFingerprints?: number;
}

export interface LoadResult {
  readonly perf: PerfReport;
  readonly accuracy: {
    readonly errorsSent: number;
    readonly errorsDrained: number;
    readonly transactionsSent: number;
    readonly transactionsDrained: number;
    readonly logsSent: number;
    readonly logsDrained: number;
    readonly distinctGroupsCreated: number;
    readonly expectedDistinctGroups: number;
  };
  readonly pipeline: Pipeline;
}

const utf8 = new TextEncoder();

export async function runLoadTest(options: LoadOptions = {}): Promise<LoadResult> {
  const errors = options.errors ?? 16_000;
  const transactions = options.transactions ?? 3_000;
  const logs = options.logs ?? 1_000;
  const distinct = options.distinctErrorFingerprints ?? 50;

  const pipeline = new Pipeline();
  const client = pipeline.sdkClient('1', { release: 'load-v1', environment: 'production' });

  const recorder = new PerfRecorder({ sampleIntervalMs: 10 });
  recorder.start();

  // ---- Errors (via SDK) ----
  for (let i = 0; i < errors; i++) {
    const bucket = i % distinct;
    const err = new Error(`LoadError #${bucket}: synthetic`);
    err.name = `LoadError${bucket}`;
    err.stack = `${err.name}: synthetic\n    at handler${bucket} (src/handler.ts:${10 + bucket}:1)`;
    client.captureException(err);
    recorder.count(1);
    if (i % 1000 === 0) {
      // Periodically flush + drain to keep memory bounded.
      await client.flush();
      pipeline.drain();
    }
    if (i % 200 === 0) {
      // Yield to the macrotask queue so the lag sampler can fire.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await client.flush();

  // ---- Transactions (direct envelope) ----
  for (let i = 0; i < transactions; i++) {
    const traceId = `txtrace${i.toString(16).padStart(26, '0')}`.slice(0, 32);
    const spanId = `txspan${i.toString(16).padStart(10, '0')}`.slice(0, 16);
    const payload = utf8.encode(
      JSON.stringify({
        event_id: `tx${i.toString(16).padStart(30, '0')}`.slice(0, 32),
        platform: 'javascript',
        transaction: `GET /api/path/${i % 20}`,
        start_timestamp: 1_700_000_000 + i * 0.01,
        timestamp: 1_700_000_000 + i * 0.01 + 0.05,
        contexts: {
          trace: { trace_id: traceId, span_id: spanId, op: 'http.server', status: 'ok' },
        },
        spans: [
          {
            trace_id: traceId,
            span_id: `c1${spanId}`.slice(0, 16),
            parent_span_id: spanId,
            op: 'db',
            description: 'SELECT n',
            start_timestamp: 1_700_000_000 + i * 0.01,
            timestamp: 1_700_000_000 + i * 0.01 + 0.02,
          },
          {
            trace_id: traceId,
            span_id: `c2${spanId}`.slice(0, 16),
            parent_span_id: spanId,
            op: 'http.client',
            description: 'GET /downstream',
            start_timestamp: 1_700_000_000 + i * 0.01 + 0.02,
            timestamp: 1_700_000_000 + i * 0.01 + 0.05,
          },
        ],
      }),
    );
    const bytes = encodeEnvelope({
      header: {},
      items: [
        { header: { type: 'transaction', length: payload.byteLength }, payload },
      ],
    });
    await pipeline.relay.fetch(
      new Request('http://relay.local/api/1/envelope/', {
        method: 'POST',
        body: bytes as BodyInit,
      }),
    );
    recorder.count(1);
    if (i % 200 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // ---- Logs ----
  for (let i = 0; i < logs; i++) {
    const payload = utf8.encode(
      JSON.stringify({
        id: `log${i}`,
        level: i % 10 === 0 ? 'error' : 'info',
        message: `log line #${i}`,
        timestamp: Date.now(),
      }),
    );
    const bytes = encodeEnvelope({
      header: {},
      items: [{ header: { type: 'log', length: payload.byteLength }, payload }],
    });
    await pipeline.relay.fetch(
      new Request('http://relay.local/api/1/envelope/', {
        method: 'POST',
        body: bytes as BodyInit,
      }),
    );
    recorder.count(1);
    if (i % 200 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // Final drain.
  const drainResult = pipeline.drain();
  const perf = await recorder.stop();

  const distinctGroupsCreated = [...pipeline.issues.all()].filter((g) => g.projectId === '1').length;

  // Reconcile counts: drainResult shows what we processed in the
  // FINAL drain pass; the periodic drains during the loop already
  // moved earlier events into the stores. Sum the IssueStore /
  // TransactionStore / LogStore counts directly for accuracy.
  const allIssues = [...pipeline.issues.all()];
  const errorsDrained = allIssues.reduce((acc, g) => acc + g.timesSeen, 0);
  const transactionsDrained = [...pipeline.transactions.all()].length;
  const logsDrained = pipeline.logs.size();

  void drainResult;

  return {
    perf,
    accuracy: {
      errorsSent: errors,
      errorsDrained,
      transactionsSent: transactions,
      transactionsDrained,
      logsSent: logs,
      logsDrained,
      distinctGroupsCreated,
      expectedDistinctGroups: distinct,
    },
    pipeline,
  };
}

/** Command-line entry: print the report to stdout. */
export async function main(): Promise<void> {
  const total = Number.parseInt(Bun.env['SR_E2E_EVENTS'] ?? '20000', 10);
  const errors = Math.floor(total * 0.8);
  const transactions = Math.floor(total * 0.15);
  const logs = total - errors - transactions;

  console.log(`\nRunning load test with ${total.toLocaleString()} events...`);
  console.log(
    `  errors=${errors.toLocaleString()}  transactions=${transactions.toLocaleString()}  logs=${logs.toLocaleString()}\n`,
  );

  const result = await runLoadTest({ errors, transactions, logs });

  console.log(formatReport('LOAD RESULTS', result.perf));
  console.log('\nACCURACY');
  console.log(`  errors:       sent ${result.accuracy.errorsSent.toLocaleString()}  drained ${result.accuracy.errorsDrained.toLocaleString()}`);
  console.log(`  transactions: sent ${result.accuracy.transactionsSent.toLocaleString()}  drained ${result.accuracy.transactionsDrained.toLocaleString()}`);
  console.log(`  logs:         sent ${result.accuracy.logsSent.toLocaleString()}  drained ${result.accuracy.logsDrained.toLocaleString()}`);
  console.log(`  distinct error groups: ${result.accuracy.distinctGroupsCreated} / ${result.accuracy.expectedDistinctGroups} expected`);
  console.log('');
}

if (import.meta.main) {
  main().catch((e) => {
    console.error('load test failed:', e);
    process.exit(1);
  });
}