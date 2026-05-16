import { describe, expect, test } from 'bun:test';
import { fingerprintEvent } from '@sr/grouping';
import type { ItemHeader } from '@sr/proto';
import {
  IngestParseError,
  type IngestSink,
  type ProcessedEvent,
  parseQueueRecord,
  processOne,
  type QueueMessage,
  runWorker,
  type SinkPayload,
} from '../src/worker';

const enc = new TextEncoder();

/** Encode an item the same way the relay does. */
function encodeItemForQueue(header: ItemHeader, payload: Uint8Array): Uint8Array {
  const h = { ...header } as Record<string, unknown>;
  if (typeof h['length'] !== 'number') h['length'] = payload.byteLength;
  const headerBytes = enc.encode(JSON.stringify(h));
  const out = new Uint8Array(headerBytes.byteLength + 1 + payload.byteLength);
  out.set(headerBytes, 0);
  out[headerBytes.byteLength] = 0x0a;
  out.set(payload, headerBytes.byteLength + 1);
  return out;
}

function makeMessage(
  topic: string,
  offset: bigint,
  header: ItemHeader,
  payload: Uint8Array,
): QueueMessage {
  return { topic, offset, payload: encodeItemForQueue(header, payload) };
}

function makeSink(): { sink: IngestSink; saved: SinkPayload[] } {
  const saved: SinkPayload[] = [];
  return {
    saved,
    sink: {
      async save(p) {
        saved.push(p);
      },
    },
  };
}

describe('parseQueueRecord', () => {
  test('round-trips a record encoded by the relay scheme', () => {
    const payload = enc.encode('{"a":1}');
    const msg = makeMessage('1:event', 5n, { type: 'event' }, payload);
    const item = parseQueueRecord(msg);
    expect(item.topic).toBe('1:event');
    expect(item.header.type).toBe('event');
    expect(item.payload).toEqual(payload);
  });

  test('rejects record without LF separator', () => {
    const msg: QueueMessage = {
      topic: 't',
      offset: 0n,
      payload: enc.encode('no-separator'),
    };
    expect(() => parseQueueRecord(msg)).toThrow(IngestParseError);
  });

  test('rejects record with invalid header JSON', () => {
    const out = new Uint8Array(10);
    out[0] = 0x6e; // 'n'
    out[1] = 0x6f; // 'o'
    out[2] = 0x0a; // LF
    out.set(enc.encode('body'), 3);
    const msg: QueueMessage = { topic: 't', offset: 0n, payload: out };
    expect(() => parseQueueRecord(msg)).toThrow(IngestParseError);
  });
});

describe('processOne — event items', () => {
  test('event item is fingerprinted and saved as ProcessedEvent', async () => {
    const { sink, saved } = makeSink();
    const event = { message: 'Database connection refused' };
    const msg = makeMessage('1:event', 0n, { type: 'event' }, enc.encode(JSON.stringify(event)));
    await processOne(msg, sink);
    expect(saved.length).toBe(1);
    const p = saved[0] as ProcessedEvent;
    expect(p.event.message).toBe('Database connection refused');
    expect(p.grouping.strategy).toBe('message');
    expect(p.grouping.groupHash).toMatch(/^[0-9a-f]{16}$/);
  });

  test('transaction items are fingerprinted too', async () => {
    const { sink, saved } = makeSink();
    const event = { exception: { values: [{ type: 'Timeout' }] } };
    const msg = makeMessage(
      '1:transaction',
      0n,
      { type: 'transaction' },
      enc.encode(JSON.stringify(event)),
    );
    await processOne(msg, sink);
    expect(saved.length).toBe(1);
    const p = saved[0] as ProcessedEvent;
    expect(p.grouping.strategy).toBe('exception');
  });

  test('explicit fingerprint flows through', async () => {
    const { sink, saved } = makeSink();
    const event = { fingerprint: ['custom-key'], message: 'msg' };
    const msg = makeMessage('1:event', 0n, { type: 'event' }, enc.encode(JSON.stringify(event)));
    await processOne(msg, sink);
    const p = saved[0] as ProcessedEvent;
    expect(p.grouping.strategy).toBe('fingerprint');
    expect(p.grouping.fingerprint).toEqual(['custom-key']);
  });

  test('invalid event JSON throws IngestParseError', async () => {
    const { sink } = makeSink();
    const msg = makeMessage('1:event', 0n, { type: 'event' }, enc.encode('not-json'));
    let err: unknown;
    try {
      await processOne(msg, sink);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IngestParseError);
  });
});

describe('processOne — non-event items', () => {
  test('attachment items pass through without fingerprinting', async () => {
    const { sink, saved } = makeSink();
    const bin = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const msg = makeMessage('1:attachment', 0n, { type: 'attachment', filename: 'crash.dmp' }, bin);
    await processOne(msg, sink);
    expect(saved.length).toBe(1);
    const saved0 = saved[0] as { header: ItemHeader; payload: Uint8Array; topic: string };
    expect(saved0.topic).toBe('1:attachment');
    expect(saved0.header.type).toBe('attachment');
    expect(saved0.payload).toEqual(bin);
  });

  test('session items pass through', async () => {
    const { sink, saved } = makeSink();
    const body = enc.encode('{"sid":"s"}');
    const msg = makeMessage('1:session', 0n, { type: 'session' }, body);
    await processOne(msg, sink);
    expect(saved.length).toBe(1);
    // Doesn't have grouping field — type-narrows to ParsedItem.
    const saved0 = saved[0] as { header: ItemHeader };
    expect(saved0.header.type).toBe('session');
  });
});

describe('runWorker — drives over async iterable', () => {
  async function* messages(items: QueueMessage[]): AsyncIterable<QueueMessage> {
    for (const m of items) yield m;
  }

  test('processes a finite stream in order with concurrency=1', async () => {
    const { sink, saved } = makeSink();
    const msgs: QueueMessage[] = [];
    for (let i = 0; i < 5; i++) {
      msgs.push(
        makeMessage(
          '1:event',
          BigInt(i),
          { type: 'event' },
          enc.encode(JSON.stringify({ message: `m${i}` })),
        ),
      );
    }
    const stats = await runWorker(messages(msgs), sink);
    expect(stats).toEqual({ processed: 5, failed: 0 });
    expect(saved.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      const p = saved[i] as ProcessedEvent;
      expect(p.event.message).toBe(`m${i}`);
    }
  });

  test('counts failures separately, continues past bad items', async () => {
    const { sink, saved } = makeSink();
    const msgs: QueueMessage[] = [
      makeMessage('1:event', 0n, { type: 'event' }, enc.encode('{"message":"ok"}')),
      makeMessage('1:event', 1n, { type: 'event' }, enc.encode('not-json')),
      makeMessage('1:event', 2n, { type: 'event' }, enc.encode('{"message":"also ok"}')),
    ];
    const stats = await runWorker(messages(msgs), sink);
    expect(stats).toEqual({ processed: 2, failed: 1 });
    expect(saved.length).toBe(2);
  });

  test('concurrency > 1 still processes everything', async () => {
    const { sink, saved } = makeSink();
    const n = 50;
    const msgs: QueueMessage[] = [];
    for (let i = 0; i < n; i++) {
      msgs.push(
        makeMessage(
          '1:event',
          BigInt(i),
          { type: 'event' },
          enc.encode(JSON.stringify({ message: `m${i}` })),
        ),
      );
    }
    const stats = await runWorker(messages(msgs), sink, { concurrency: 8 });
    expect(stats.processed).toBe(n);
    expect(saved.length).toBe(n);
  });
});

describe('end-to-end — relay-encoded item parses cleanly through ingest', () => {
  test('event fingerprint matches what fingerprintEvent would return directly', async () => {
    const { sink, saved } = makeSink();
    const event = {
      platform: 'python',
      exception: {
        values: [
          {
            type: 'KeyError',
            value: 'missing',
            stacktrace: {
              frames: [{ abs_path: '/srv/app/api.py', module: 'app.api', function: 'lookup' }],
            },
          },
        ],
      },
    };
    const msg = makeMessage('7:event', 99n, { type: 'event' }, enc.encode(JSON.stringify(event)));
    await processOne(msg, sink);
    const got = saved[0] as ProcessedEvent;
    const expected = fingerprintEvent(event);
    expect(got.grouping.groupHash).toBe(expected.groupHash);
    expect(got.grouping.strategy).toBe('stacktrace');
  });
});
