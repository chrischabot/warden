import { describe, expect, test } from 'bun:test';
import { parseEnvelope } from '@sr/proto';
import { Client, NoopTransport } from '../src/index';

const DSN = 'https://abc123@relay.test/1';

function makeClient() {
  const transport = new NoopTransport();
  const client = new Client({ dsn: DSN, transport });
  return { client, transport };
}

describe('Client — capture surface', () => {
  test('captureException sends an envelope with an event item', async () => {
    const { client, transport } = makeClient();
    const id = client.captureException(new Error('boom'));
    await client.flush();
    expect(transport.sent.length).toBe(1);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const env = parseEnvelope(transport.sent[0] as Uint8Array);
    expect(env.header.event_id).toBe(id);
    expect(env.items.length).toBe(1);
    expect(env.items[0]?.header.type).toBe('event');
    const body = JSON.parse(new TextDecoder().decode(env.items[0]?.payload)) as {
      event_id: string;
      exception: { values: Array<{ type: string; value: string }> };
    };
    expect(body.event_id).toBe(id);
    expect(body.exception.values[0]?.type).toBe('Error');
    expect(body.exception.values[0]?.value).toBe('boom');
  });

  test('captureMessage produces a message-type event', async () => {
    const { client, transport } = makeClient();
    client.captureMessage('hello world');
    await client.flush();
    const env = parseEnvelope(transport.sent[0] as Uint8Array);
    const body = JSON.parse(new TextDecoder().decode(env.items[0]?.payload)) as {
      message: string;
      level: string;
    };
    expect(body.message).toBe('hello world');
    expect(body.level).toBe('info');
  });

  test('captureEvent forwards an explicit event verbatim', async () => {
    const { client, transport } = makeClient();
    client.captureEvent({
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: '2024-01-01T00:00:00Z',
      message: 'explicit',
    });
    await client.flush();
    const env = parseEnvelope(transport.sent[0] as Uint8Array);
    const body = JSON.parse(new TextDecoder().decode(env.items[0]?.payload)) as {
      event_id: string;
      message: string;
    };
    expect(body.event_id).toBe('0123456789abcdef0123456789abcdef');
    expect(body.message).toBe('explicit');
  });

  test('applies release and environment defaults from options', async () => {
    const transport = new NoopTransport();
    const client = new Client({
      dsn: DSN,
      transport,
      release: 'v1.2.3',
      environment: 'staging',
    });
    client.captureMessage('x');
    await client.flush();
    const env = parseEnvelope(transport.sent[0] as Uint8Array);
    const body = JSON.parse(new TextDecoder().decode(env.items[0]?.payload)) as {
      release: string;
      environment: string;
    };
    expect(body.release).toBe('v1.2.3');
    expect(body.environment).toBe('staging');
  });

  test('event-level release/environment override client defaults', async () => {
    const transport = new NoopTransport();
    const client = new Client({
      dsn: DSN,
      transport,
      release: 'default',
    });
    client.captureEvent({
      event_id: newEventIdHere(),
      timestamp: '2024-01-01T00:00:00Z',
      release: 'override',
    });
    await client.flush();
    const env = parseEnvelope(transport.sent[0] as Uint8Array);
    const body = JSON.parse(new TextDecoder().decode(env.items[0]?.payload)) as {
      release: string;
    };
    expect(body.release).toBe('override');
  });
});

function newEventIdHere(): string {
  return '0'.repeat(32);
}

describe('Client — DSN validation', () => {
  test('rejects malformed DSN', () => {
    expect(() => new Client({ dsn: 'not-a-dsn' })).toThrow();
  });
});

describe('Client — flush + close', () => {
  test('flush resolves when nothing in-flight', async () => {
    const { client } = makeClient();
    expect(await client.flush()).toBe(true);
  });

  test('close behaves like flush', async () => {
    const { client } = makeClient();
    client.captureMessage('one');
    expect(await client.close()).toBe(true);
  });
});
