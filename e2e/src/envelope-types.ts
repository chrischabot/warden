/**
 * 10 envelope item type tests.
 *
 * Each test builds an envelope with a single item of the given type,
 * sends it through the real relay handler, drains the queue, and
 * asserts the pipeline routed it into the correct store.
 */

import { encodeEnvelope } from '@sr/proto';
import type { ItemHeader } from '@sr/proto';
import type { Pipeline } from './pipeline';

export interface EnvelopeTypeTest {
  readonly type: string;
  readonly description: string;
  send(pipeline: Pipeline, projectId: string): Promise<void>;
  assert(pipeline: Pipeline, projectId: string): void;
}

async function postEnvelope(
  pipeline: Pipeline,
  projectId: string,
  itemHeader: ItemHeader,
  payload: Uint8Array,
  envelopeHeader: Record<string, unknown> = {},
): Promise<void> {
  const bytes = encodeEnvelope({
    header: envelopeHeader,
    items: [
      {
        header: { ...itemHeader, length: payload.byteLength },
        payload,
      },
    ],
  });
  const url = `http://relay.local/api/${projectId}/envelope/`;
  await pipeline.relay.fetch(
    new Request(url, { method: 'POST', body: bytes as BodyInit }),
  );
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export const ENVELOPE_TYPES: readonly EnvelopeTypeTest[] = [
  // 1. event (error)
  {
    type: 'event',
    description: 'error event → IssueStore via fingerprint',
    async send(pipeline, projectId) {
      const payload = utf8Encode(
        JSON.stringify({
          event_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
          timestamp: new Date().toISOString(),
          platform: 'javascript',
          level: 'error',
          exception: {
            values: [{ type: 'TypeError', value: 'envelope-test', stacktrace: { frames: [] } }],
          },
        }),
      );
      await postEnvelope(pipeline, projectId, { type: 'event' }, payload);
    },
    assert(pipeline, projectId) {
      pipeline.drain();
      const found = pipeline.issues
        .list({ projectId })
        .groups.some((g) => g.message.includes('envelope-test'));
      if (!found) throw new Error('event item not routed to IssueStore');
    },
  },

  // 2. transaction
  {
    type: 'transaction',
    description: 'transaction → TransactionStore with op/duration',
    async send(pipeline, projectId) {
      const payload = utf8Encode(
        JSON.stringify({
          event_id: 'tx1aaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
          platform: 'javascript',
          transaction: 'envelope-tx',
          start_timestamp: 1700000000,
          timestamp: 1700000000.5,
          contexts: {
            trace: {
              trace_id: 'envelope-trace-aaaaaaaaaaaaaaaaaaaaaaaa',
              span_id: 'envelopespan0001',
              op: 'http.server',
              status: 'ok',
            },
          },
        }),
      );
      await postEnvelope(pipeline, projectId, { type: 'transaction' }, payload);
    },
    assert(pipeline) {
      pipeline.drain();
      const r = pipeline.transactions.list({ transactionName: 'envelope-tx' });
      if (r.total !== 1) throw new Error(`expected 1 transaction, got ${r.total}`);
      const tx = r.transactions[0]!;
      if (tx.op !== 'http.server') throw new Error('op mismatch');
      if (Math.abs(tx.durationMs - 500) > 1) throw new Error(`duration mismatch: ${tx.durationMs}`);
    },
  },

  // 3. log
  {
    type: 'log',
    description: 'log → LogStore',
    async send(pipeline, projectId) {
      const payload = utf8Encode(
        JSON.stringify({
          id: 'log-envelope-1',
          level: 'warning',
          message: 'queue depth exceeded soft target',
          timestamp: Date.now(),
        }),
      );
      await postEnvelope(pipeline, projectId, { type: 'log' }, payload);
    },
    assert(pipeline) {
      pipeline.drain();
      const q = pipeline.logs.query({ searchSubstring: 'queue depth' });
      if (q.total !== 1) throw new Error(`expected 1 log, got ${q.total}`);
    },
  },

  // 4. statsd custom metric (counter)
  {
    type: 'statsd',
    description: 'statsd line → MetricStore counter aggregate',
    async send(pipeline, projectId) {
      const ts = Math.floor(Date.now() / 1000);
      const payload = utf8Encode(`requests_total@none:1|c|#route:/api/users|T${ts}`);
      await postEnvelope(pipeline, projectId, { type: 'statsd' }, payload);
    },
    assert(pipeline) {
      pipeline.drain();
      const buckets = pipeline.metrics.query({ name: 'requests_total' });
      if (buckets.length !== 1) throw new Error(`expected 1 metric bucket, got ${buckets.length}`);
    },
  },

  // 5. session
  {
    type: 'session',
    description: 'session → session counter increments',
    async send(pipeline, projectId) {
      const payload = utf8Encode(
        JSON.stringify({
          sid: crypto.randomUUID(),
          init: true,
          status: 'ok',
          attrs: { release: 'v1.0' },
        }),
      );
      await postEnvelope(pipeline, projectId, { type: 'session' }, payload);
    },
    assert(pipeline) {
      const before = pipeline.sessionsRecorded;
      pipeline.drain();
      if (pipeline.sessionsRecorded <= before) throw new Error('session count did not advance');
    },
  },

  // 6. attachment (binary)
  {
    type: 'attachment',
    description: 'attachment binary payload survives the queue and gets acked',
    async send(pipeline, projectId) {
      const bin = new Uint8Array(1024);
      for (let i = 0; i < bin.length; i++) bin[i] = i & 0xff;
      await postEnvelope(
        pipeline,
        projectId,
        { type: 'attachment', filename: 'crash.dmp', attachment_type: 'event.minidump' },
        bin,
      );
    },
    assert(pipeline) {
      const before = pipeline.attachmentsRecorded;
      pipeline.drain();
      if (pipeline.attachmentsRecorded <= before) throw new Error('attachment not acked');
    },
  },

  // 7. profile
  {
    type: 'profile',
    description: 'profile → ProfileStore',
    async send(pipeline, projectId) {
      const payload = utf8Encode(
        JSON.stringify({
          event_id: 'prof1aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          platform: 'javascript',
          trace_id: 'trace-prof-aaaaaaaaaaaaaaaaaaaaaaaaaaa',
          transaction_name: 'enqueue.work',
          timestamp: new Date().toISOString(),
          duration_ns: 50_000_000,
          sampling_rate_hz: 101,
          profile: {
            frames: [{ function: 'main' }, { function: 'work' }],
            threads: [{ id: 0, name: 'main' }],
            samples: [
              { thread_id: 0, relative_ts_ns: 0, stack: [1, 0] },
              { thread_id: 0, relative_ts_ns: 10_000_000, stack: [1, 0] },
            ],
          },
        }),
      );
      await postEnvelope(pipeline, projectId, { type: 'profile' }, payload);
    },
    assert(pipeline) {
      pipeline.drain();
      const list = pipeline.profiles.list({ transactionName: 'enqueue.work' });
      if (list.length !== 1) throw new Error(`expected 1 profile, got ${list.length}`);
    },
  },

  // 8. replay_recording
  {
    type: 'replay_recording',
    description: 'replay_recording segment → ReplayStore',
    async send(pipeline, projectId) {
      const bin = utf8Encode('opaque-rrweb-payload');
      await postEnvelope(
        pipeline,
        projectId,
        {
          type: 'replay_recording',
          replay_id: 'replay-envelope-1',
          segment_id: 0,
          url: '/dashboard',
          error_count: 0,
        },
        bin,
      );
    },
    assert(pipeline) {
      pipeline.drain();
      const replay = pipeline.replays.get('replay-envelope-1');
      if (!replay) throw new Error('replay not created');
      if (replay.segmentCount !== 1) throw new Error(`expected 1 segment, got ${replay.segmentCount}`);
    },
  },

  // 9. check_in
  {
    type: 'check_in',
    description: 'check_in item → relay enqueues and pipeline tracks it',
    async send(pipeline, projectId) {
      const payload = utf8Encode(
        JSON.stringify({
          check_in_id: crypto.randomUUID(),
          monitor_slug: 'envelope-check',
          status: 'in_progress',
        }),
      );
      await postEnvelope(pipeline, projectId, { type: 'check_in' }, payload);
    },
    assert(pipeline) {
      const before = pipeline.checkInsRecorded;
      pipeline.drain();
      if (pipeline.checkInsRecorded <= before) throw new Error('check_in not recorded');
    },
  },

  // 10. user_report
  {
    type: 'user_report',
    description: 'user_report feedback survives the pipeline',
    async send(pipeline, projectId) {
      const payload = utf8Encode(
        JSON.stringify({
          event_id: 'evt-feedback-aaaaaaaaaaaaaaaaaaa1',
          name: 'Alice',
          email: 'alice@example.com',
          comments: 'It worked initially then stopped.',
        }),
      );
      await postEnvelope(pipeline, projectId, { type: 'user_report' }, payload);
    },
    assert(pipeline) {
      const before = pipeline.userReportsRecorded;
      pipeline.drain();
      if (pipeline.userReportsRecorded <= before) throw new Error('user_report not recorded');
    },
  },
];