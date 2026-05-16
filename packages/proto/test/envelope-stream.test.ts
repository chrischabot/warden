import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  EnvelopeParseError,
  encodeEnvelope,
  parseEnvelope,
  parseEnvelopeStream,
} from '../src/envelope';
import type { Envelope } from '../src/index';

const enc = new TextEncoder();

/** Build a ReadableStream that yields the given bytes in `chunks` size pieces. */
function streamOf(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let off = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (off >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(off + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(off, end));
      off = end;
    },
  });
}

async function consume(stream: ReadableStream<Uint8Array>) {
  const out: Array<{ kind: string; data: unknown }> = [];
  for await (const ev of parseEnvelopeStream(stream)) {
    if (ev.kind === 'envelope-header') {
      out.push({ kind: 'envelope-header', data: ev.header });
    } else {
      out.push({
        kind: 'item',
        data: { type: ev.header.type, payload: ev.payload },
      });
    }
  }
  return out;
}

describe('parseEnvelopeStream — chunking', () => {
  const env: Envelope = {
    header: { event_id: 'abc' },
    items: [
      { header: { type: 'event' }, payload: enc.encode('{"m":"hi"}') },
      {
        header: { type: 'attachment', length: 8 },
        payload: Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7),
      },
    ],
  };
  const bytes = encodeEnvelope(env);

  for (const chunkSize of [1, 2, 7, 13, 64, bytes.byteLength]) {
    test(`chunk size ${chunkSize}`, async () => {
      const events = await consume(streamOf(bytes, chunkSize));
      expect(events.length).toBe(3);
      expect(events[0]!.kind).toBe('envelope-header');
      expect((events[0]!.data as { event_id: string }).event_id).toBe('abc');
      expect(events[1]!.kind).toBe('item');
      expect(events[2]!.kind).toBe('item');
      const attach = events[2]!.data as { type: string; payload: Uint8Array };
      expect(attach.type).toBe('attachment');
      expect(attach.payload).toEqual(Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7));
    });
  }
});

describe('parseEnvelopeStream — malformed', () => {
  test('empty stream throws', async () => {
    const stream = streamOf(new Uint8Array(0), 1);
    let err: unknown;
    try {
      await consume(stream);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvelopeParseError);
  });

  test('truncated length-prefixed payload throws', async () => {
    const truncated = enc.encode('{}\n{"type":"attachment","length":100}\nshort');
    const stream = streamOf(truncated, 4);
    let err: unknown;
    try {
      await consume(stream);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvelopeParseError);
  });
});

describe('parseEnvelopeStream — property', () => {
  test('streaming output matches eager parse for any chunk size', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          eid: fc.hexaString({ minLength: 16, maxLength: 16 }),
          items: fc.array(
            fc.record({
              type: fc.constantFrom('event', 'attachment', 'session', 'log'),
              payload: fc.uint8Array({ minLength: 0, maxLength: 128 }),
            }),
            { minLength: 0, maxLength: 6 },
          ),
          chunkSize: fc.integer({ min: 1, max: 64 }),
        }),
        async (input) => {
          const env: Envelope = {
            header: { event_id: input.eid },
            items: input.items.map((it) => ({
              header: { type: it.type, length: it.payload.byteLength },
              payload: it.payload,
            })),
          };
          const bytes = encodeEnvelope(env);
          const eager = parseEnvelope(bytes);
          const streamed = await consume(streamOf(bytes, input.chunkSize));

          // streamed[0] is envelope-header; the rest are items.
          expect(streamed.length).toBe(1 + eager.items.length);
          for (let i = 0; i < eager.items.length; i++) {
            const ev = streamed[i + 1]!.data as { type: string; payload: Uint8Array };
            expect(ev.type).toBe(eager.items[i]!.header.type);
            expect(ev.payload).toEqual(eager.items[i]!.payload);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
