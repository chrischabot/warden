import { describe, expect, test } from 'bun:test';
import { BufferedOutcomeRecorder } from '@sr/outcomes';
import { defaultScrubber } from '@sr/pii';
import type { Envelope } from '@sr/proto';
import { encodeEnvelope } from '@sr/proto';
import { RateLimiter } from '@sr/rate-limit';
import { Sampler } from '@sr/sampling';
import { createRelay, type RelayQueue } from '../src/handler';

function makeQueue(): {
  queue: RelayQueue;
  appends: Array<{ topic: string; payload: Uint8Array }>;
} {
  const appends: Array<{ topic: string; payload: Uint8Array }> = [];
  let nextOffset = 0n;
  const queue: RelayQueue = {
    async append(topic, payload) {
      appends.push({ topic, payload });
      const off = nextOffset;
      nextOffset++;
      return off;
    },
  };
  return { queue, appends };
}

function makeRequest(method: string, pathname: string, body: Uint8Array | string | null): Request {
  const url = `http://relay.test${pathname}`;
  return new Request(url, body !== null ? { method, body: body as BodyInit } : { method });
}

// ---- basic routing (regression coverage from the first cut) ----

describe('relay handler — routing', () => {
  test('rejects unknown path with 404', async () => {
    const { queue } = makeQueue();
    const relay = createRelay({ queue });
    const res = await relay.fetch(makeRequest('POST', '/whatever', null));
    expect(res.status).toBe(404);
  });

  test('rejects wrong method with 405', async () => {
    const { queue } = makeQueue();
    const relay = createRelay({ queue });
    const res = await relay.fetch(makeRequest('GET', '/api/1/envelope/', null));
    expect(res.status).toBe(405);
  });

  test('rejects POST with no body with 400', async () => {
    const { queue } = makeQueue();
    const relay = createRelay({ queue });
    const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', null));
    expect(res.status).toBe(400);
  });

  test('rejects non-numeric project id with 404', async () => {
    const { queue } = makeQueue();
    const relay = createRelay({ queue });
    const env: Envelope = {
      header: {},
      items: [{ header: { type: 'event' }, payload: new TextEncoder().encode('{}') }],
    };
    const res = await relay.fetch(makeRequest('POST', '/api/abc/envelope/', encodeEnvelope(env)));
    expect(res.status).toBe(404);
  });
});

// ---- envelope ingestion ----

describe('relay handler — envelope ingestion', () => {
  test('accepts an envelope with one event item and enqueues it', async () => {
    const { queue, appends } = makeQueue();
    const relay = createRelay({ queue });
    const payload = new TextEncoder().encode('{"message":"hi","level":"error"}');
    const env: Envelope = {
      header: { event_id: 'abc123' },
      items: [{ header: { type: 'event', length: payload.byteLength }, payload }],
    };
    const res = await relay.fetch(makeRequest('POST', '/api/42/envelope/', encodeEnvelope(env)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; accepted: number; rate_limited: number };
    expect(body.id).toBe('abc123');
    expect(body.accepted).toBe(1);
    expect(body.rate_limited).toBe(0);
    expect(appends.length).toBe(1);
    expect(appends[0]?.topic).toBe('42:event');
  });

  test('multi-item envelope all enqueue', async () => {
    const { queue, appends } = makeQueue();
    const relay = createRelay({ queue });
    const env: Envelope = {
      header: { event_id: 'multi' },
      items: [
        { header: { type: 'event' }, payload: new TextEncoder().encode('{"a":1}') },
        {
          header: { type: 'attachment', length: 4, filename: 'crash.dmp' },
          payload: Uint8Array.of(1, 2, 3, 4),
        },
        { header: { type: 'session' }, payload: new TextEncoder().encode('{"sid":"s"}') },
      ],
    };
    const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
    expect(res.status).toBe(200);
    expect(appends.length).toBe(3);
  });

  test('malformed envelope returns 400 and records invalid outcome', async () => {
    const { queue } = makeQueue();
    const outcomes = new BufferedOutcomeRecorder();
    const relay = createRelay({ queue, outcomes });
    const bad = new TextEncoder().encode('not a valid envelope\n');
    const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', bad));
    expect(res.status).toBe(400);
    const seen = outcomes.peek();
    expect(seen.length).toBe(1);
    expect(seen[0]?.reason).toBe('invalid');
    expect(seen[0]?.projectId).toBe('1');
  });
});

// ---- rate limiting ----

describe('relay handler — rate limiting', () => {
  test('rate-limited items are dropped, accounted, and 429 returned when nothing accepted', async () => {
    const { queue, appends } = makeQueue();
    const outcomes = new BufferedOutcomeRecorder();
    const rateLimiter = new RateLimiter({
      defaultCapacity: 1,
      defaultRefillPerSec: 0,
    });
    const relay = createRelay({ queue, outcomes, rateLimiter });

    // First envelope (1 event) passes.
    const env1: Envelope = {
      header: {},
      items: [{ header: { type: 'event' }, payload: new TextEncoder().encode('{}') }],
    };
    const res1 = await relay.fetch(makeRequest('POST', '/api/9/envelope/', encodeEnvelope(env1)));
    expect(res1.status).toBe(200);
    expect(appends.length).toBe(1);

    // Second envelope (1 event) hits rate limit (capacity=1 already consumed).
    const env2: Envelope = {
      header: {},
      items: [{ header: { type: 'event' }, payload: new TextEncoder().encode('{}') }],
    };
    const res2 = await relay.fetch(makeRequest('POST', '/api/9/envelope/', encodeEnvelope(env2)));
    expect(res2.status).toBe(429);
    const body = (await res2.json()) as { rate_limited: number };
    expect(body.rate_limited).toBe(1);
    // No new enqueue.
    expect(appends.length).toBe(1);
    // Outcomes: one accepted (env1) + one rate_limited (env2).
    const seen = outcomes.peek();
    expect(seen.length).toBe(2);
    expect(seen[0]?.reason).toBe('accepted');
    expect(seen[1]?.reason).toBe('rate_limited');
  });

  test('mixed envelope: accepted items enqueue, rate-limited items skip', async () => {
    const { queue, appends } = makeQueue();
    const outcomes = new BufferedOutcomeRecorder();
    const rateLimiter = new RateLimiter({
      rules: [{ projectId: '*', dataCategory: 'event', capacity: 1, refillPerSec: 0 }],
      defaultCapacity: 100,
      defaultRefillPerSec: 0,
    });
    const relay = createRelay({ queue, outcomes, rateLimiter });
    const env: Envelope = {
      header: {},
      items: [
        { header: { type: 'event' }, payload: new TextEncoder().encode('{}') },
        { header: { type: 'event' }, payload: new TextEncoder().encode('{}') }, // rate-limited
        { header: { type: 'attachment', length: 4 }, payload: Uint8Array.of(1, 2, 3, 4) },
      ],
    };
    const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number; rate_limited: number };
    expect(body.accepted).toBe(2);
    expect(body.rate_limited).toBe(1);
    expect(appends.length).toBe(2);
  });
});

// ---- PII scrubbing ----

describe('relay handler — PII scrubbing', () => {
  test('scrubs email in event JSON payload before enqueueing', async () => {
    const { queue, appends } = makeQueue();
    const scrubber = defaultScrubber();
    const relay = createRelay({ queue, scrubber });
    const payload = new TextEncoder().encode(
      JSON.stringify({ message: 'contact alice@example.com please' }),
    );
    const env: Envelope = {
      header: {},
      items: [{ header: { type: 'event', length: payload.byteLength }, payload }],
    };
    const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
    expect(res.status).toBe(200);
    const queued = appends[0]?.payload as Uint8Array;
    const lf = queued.indexOf(0x0a);
    const bodyJson = new TextDecoder().decode(queued.subarray(lf + 1));
    const parsed = JSON.parse(bodyJson) as { message: string };
    expect(parsed.message).toBe('contact [Filtered] please');
  });

  test('does NOT scrub attachment bytes', async () => {
    const { queue, appends } = makeQueue();
    const scrubber = defaultScrubber();
    const relay = createRelay({ queue, scrubber });
    // An attachment that contains an email-like ASCII string in its bytes.
    const bin = new TextEncoder().encode('crashdump-alice@example.com-binary-data');
    const env: Envelope = {
      header: {},
      items: [
        {
          header: { type: 'attachment', length: bin.byteLength, filename: 'crash.dmp' },
          payload: bin,
        },
      ],
    };
    const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
    expect(res.status).toBe(200);
    const queued = appends[0]?.payload as Uint8Array;
    const lf = queued.indexOf(0x0a);
    const body = queued.subarray(lf + 1);
    expect(body).toEqual(bin); // unchanged
  });
});

// ---- outcomes ----

describe('relay handler — outcomes', () => {
  test('records accepted outcomes per item', async () => {
    const { queue } = makeQueue();
    const outcomes = new BufferedOutcomeRecorder();
    const relay = createRelay({ queue, outcomes });
    const env: Envelope = {
      header: {},
      items: [
        { header: { type: 'event' }, payload: new TextEncoder().encode('{}') },
        { header: { type: 'session' }, payload: new TextEncoder().encode('{}') },
      ],
    };
    await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
    const seen = outcomes.peek();
    expect(seen.length).toBe(2);
    expect(seen.every((o) => o.reason === 'accepted')).toBe(true);
    expect(seen[0]?.dataCategory).toBe('event');
    expect(seen[1]?.dataCategory).toBe('session');
  });
});

// ---- dynamic sampling ----

describe('relay handler — dynamic sampling', () => {
  test('sampler rate=0 drops every item with a filtered outcome and no enqueue', async () => {
    const { queue, appends } = makeQueue();
    const outcomes = new BufferedOutcomeRecorder();
    const sampler = new Sampler([], { defaultSampleRate: 0 });
    const relay = createRelay({ queue, outcomes, sampler });
    const env: Envelope = {
      header: { trace: { trace_id: 'a'.repeat(32), public_key: 'k' } },
      items: [
        { header: { type: 'event' }, payload: new TextEncoder().encode('{}') },
        { header: { type: 'transaction' }, payload: new TextEncoder().encode('{}') },
      ],
    };
    const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number; filtered: number };
    expect(body.accepted).toBe(0);
    expect(body.filtered).toBe(2);
    expect(appends.length).toBe(0);
    const seen = outcomes.peek();
    expect(seen.length).toBe(2);
    expect(seen.every((o) => o.reason === 'filtered')).toBe(true);
  });

  test('sampler rate=1 (default) passes everything', async () => {
    const { queue, appends } = makeQueue();
    const sampler = new Sampler([], { defaultSampleRate: 1 });
    const relay = createRelay({ queue, sampler });
    const env: Envelope = {
      header: {},
      items: [
        { header: { type: 'event' }, payload: new TextEncoder().encode('{}') },
        { header: { type: 'event' }, payload: new TextEncoder().encode('{}') },
      ],
    };
    const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
    expect(res.status).toBe(200);
    expect(appends.length).toBe(2);
  });

  test('sampler decision is deterministic on envelope trace_id', async () => {
    const sampler = new Sampler([], { defaultSampleRate: 0.5 });
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const env: Envelope = {
      header: { trace: { trace_id: traceId, public_key: 'k' } },
      items: [{ header: { type: 'event' }, payload: new TextEncoder().encode('{}') }],
    };

    let firstAccepted = -1;
    for (let i = 0; i < 2; i++) {
      const { queue, appends } = makeQueue();
      const relay = createRelay({ queue, sampler });
      const res = await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
      const body = (await res.json()) as { accepted: number };
      if (firstAccepted < 0) firstAccepted = body.accepted;
      else expect(body.accepted).toBe(firstAccepted);
      expect(appends.length).toBe(body.accepted);
    }
  });

  test('rate-limit precedes sampling: rate-limited items never reach the sampler', async () => {
    const { queue } = makeQueue();
    const outcomes = new BufferedOutcomeRecorder();
    const rateLimiter = new RateLimiter({ defaultCapacity: 1, defaultRefillPerSec: 0 });
    const sampler = new Sampler([], { defaultSampleRate: 0 });
    const relay = createRelay({ queue, outcomes, rateLimiter, sampler });
    const env: Envelope = {
      header: {},
      items: [
        { header: { type: 'event' }, payload: new TextEncoder().encode('{}') },
        { header: { type: 'event' }, payload: new TextEncoder().encode('{}') },
      ],
    };
    await relay.fetch(makeRequest('POST', '/api/1/envelope/', encodeEnvelope(env)));
    const reasons = outcomes
      .peek()
      .map((o) => o.reason)
      .sort();
    expect(reasons).toEqual(['filtered', 'rate_limited']);
  });
});
