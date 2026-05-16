import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { EnvelopeParseError, encodeEnvelope, parseEnvelope } from '../src/envelope';
import type { Envelope, EnvelopeHeader, Item, ItemType } from '../src/index';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('encode/decode round trip', () => {
  test('header only', () => {
    const env: Envelope = {
      header: { event_id: 'abc', sent_at: '2024-01-01T00:00:00Z' },
      items: [],
    };
    const bytes = encodeEnvelope(env);
    const parsed = parseEnvelope(bytes);
    expect(parsed.header).toEqual(env.header);
    expect(parsed.items).toEqual([]);
  });

  test('single event item with JSON payload', () => {
    const payloadObj = { message: 'hi', level: 'error', platform: 'javascript' };
    const payload = enc.encode(JSON.stringify(payloadObj));
    const env: Envelope = {
      header: { event_id: 'e1' },
      items: [{ header: { type: 'event' }, payload }],
    };
    const bytes = encodeEnvelope(env);
    const parsed = parseEnvelope(bytes);
    expect(parsed.items.length).toBe(1);
    const item = parsed.items[0]!;
    expect(item.header.type).toBe('event');
    expect(JSON.parse(dec.decode(item.payload))).toEqual(payloadObj);
  });

  test('binary attachment with declared length', () => {
    const bin = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bin[i] = i;
    const env: Envelope = {
      header: {},
      items: [
        {
          header: { type: 'attachment', length: 256, filename: 'crash.dmp' },
          payload: bin,
        },
      ],
    };
    const bytes = encodeEnvelope(env);
    const parsed = parseEnvelope(bytes);
    expect(parsed.items[0]!.payload).toEqual(bin);
    expect(parsed.items[0]!.header.filename).toBe('crash.dmp');
  });

  test('multiple items in one envelope', () => {
    const env: Envelope = {
      header: { event_id: 'multi' },
      items: [
        { header: { type: 'event' }, payload: enc.encode('{"a":1}') },
        { header: { type: 'attachment', length: 4 }, payload: Uint8Array.of(1, 2, 3, 4) },
        { header: { type: 'session' }, payload: enc.encode('{"sid":"s"}') },
      ],
    };
    const bytes = encodeEnvelope(env);
    const parsed = parseEnvelope(bytes);
    expect(parsed.items.length).toBe(3);
    expect(parsed.items[0]!.header.type).toBe('event');
    expect(parsed.items[1]!.header.type).toBe('attachment');
    expect(parsed.items[1]!.payload).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(parsed.items[2]!.header.type).toBe('session');
  });

  test('null byte and high-bit binary payload survives intact', () => {
    const bin = new Uint8Array([0, 0x0a, 0xff, 0xfe, 0x7f, 0x80]);
    const env: Envelope = {
      header: {},
      items: [{ header: { type: 'attachment', length: bin.byteLength }, payload: bin }],
    };
    const bytes = encodeEnvelope(env);
    const parsed = parseEnvelope(bytes);
    expect(parsed.items[0]!.payload).toEqual(bin);
  });
});

describe('parseEnvelope — malformed', () => {
  test('empty buffer throws', () => {
    expect(() => parseEnvelope(new Uint8Array(0))).toThrow(EnvelopeParseError);
  });

  test('non-object envelope header throws', () => {
    expect(() => parseEnvelope(enc.encode('"a string"\n'))).toThrow(/expected JSON object/);
  });

  test('declared length exceeds buffer throws', () => {
    const bytes = enc.encode('{}\n{"type":"attachment","length":999999}\nshort');
    expect(() => parseEnvelope(bytes)).toThrow(/exceeds remaining buffer/);
  });

  test('invalid JSON in item header throws', () => {
    const bytes = enc.encode('{}\nnot-json\nbody\n');
    expect(() => parseEnvelope(bytes)).toThrow(/invalid JSON/);
  });
});

describe('property-based round trips', () => {
  const itemTypes: ItemType[] = ['event', 'transaction', 'attachment', 'session', 'profile', 'log'];

  const itemArb = fc.record({
    type: fc.constantFrom(...itemTypes),
    payload: fc.uint8Array({ minLength: 0, maxLength: 512 }),
  });

  test('arbitrary item streams round-trip byte-stable', () => {
    fc.assert(
      fc.property(
        fc.record({
          event_id: fc.hexaString({ minLength: 32, maxLength: 32 }),
          items: fc.array(itemArb, { minLength: 0, maxLength: 8 }),
        }),
        (input) => {
          const env: Envelope = {
            header: { event_id: input.event_id } satisfies EnvelopeHeader,
            items: input.items.map(
              (it): Item => ({
                header: { type: it.type, length: it.payload.byteLength },
                payload: it.payload,
              }),
            ),
          };
          const bytes = encodeEnvelope(env);
          const parsed = parseEnvelope(bytes);
          expect(parsed.header.event_id).toBe(input.event_id);
          expect(parsed.items.length).toBe(input.items.length);
          for (let i = 0; i < input.items.length; i++) {
            const expected = input.items[i]!;
            const got = parsed.items[i]!;
            expect(got.header.type).toBe(expected.type);
            expect(got.payload).toEqual(expected.payload);
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
