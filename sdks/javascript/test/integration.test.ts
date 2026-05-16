import { describe, expect, test } from 'bun:test';
import { createRelay, type RelayHandler, type RelayQueue } from '../../../apps/relay/src/handler';
import { Client, type Transport } from '../src/index';

/** Transport that calls the relay handler in-process — no HTTP. */
class InProcessTransport implements Transport {
  readonly handler: RelayHandler;
  readonly envelopeUrl: string;
  readonly inflight: Array<Promise<Response>> = [];
  readonly responses: Response[] = [];

  constructor(handler: RelayHandler, envelopeUrl: string) {
    this.handler = handler;
    this.envelopeUrl = envelopeUrl;
  }

  async send(envelope: Uint8Array): Promise<void> {
    const req = new Request(this.envelopeUrl, {
      method: 'POST',
      body: envelope as BodyInit,
    });
    const p = this.handler.fetch(req);
    this.inflight.push(p);
    p.then((r) => this.responses.push(r)).catch(() => {
      // observed via flush
    });
    await Promise.resolve();
  }

  async flush(): Promise<boolean> {
    if (this.inflight.length === 0) return true;
    await Promise.allSettled(this.inflight);
    return true;
  }
}

function makeRelay(): {
  relay: RelayHandler;
  appends: Array<{ topic: string; payload: Uint8Array }>;
  envelopeUrl: string;
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
  const relay = createRelay({ queue });
  return { relay, appends, envelopeUrl: 'http://relay.test/api/1/envelope/' };
}

describe('SDK → relay integration', () => {
  test('captureException flows through to a queue append', async () => {
    const { relay, appends, envelopeUrl } = makeRelay();
    const transport = new InProcessTransport(relay, envelopeUrl);
    const client = new Client({ dsn: 'https://abc@relay.test/1', transport });
    const id = client.captureException(new Error('integration boom'));
    await client.flush();

    expect(appends.length).toBe(1);
    expect(appends[0]?.topic).toBe('1:event');
    // Inside the queued bytes is `headerJson\npayload` per the relay's wire form.
    const queued = appends[0]?.payload as Uint8Array;
    const lf = queued.indexOf(0x0a);
    const body = new TextDecoder().decode(queued.subarray(lf + 1));
    const event = JSON.parse(body) as {
      event_id: string;
      exception: { values: Array<{ value: string }> };
    };
    expect(event.event_id).toBe(id);
    expect(event.exception.values[0]?.value).toBe('integration boom');
    // Relay must have returned 200.
    expect(transport.responses[0]?.status).toBe(200);
  });

  test('captureMessage flows through', async () => {
    const { relay, appends, envelopeUrl } = makeRelay();
    const transport = new InProcessTransport(relay, envelopeUrl);
    const client = new Client({ dsn: 'https://abc@relay.test/1', transport });
    client.captureMessage('integration-hello');
    await client.flush();
    expect(appends.length).toBe(1);
    const queued = appends[0]?.payload as Uint8Array;
    const lf = queued.indexOf(0x0a);
    const body = JSON.parse(new TextDecoder().decode(queued.subarray(lf + 1))) as {
      message: string;
    };
    expect(body.message).toBe('integration-hello');
  });

  test('multiple events stack up and flush together', async () => {
    const { relay, appends, envelopeUrl } = makeRelay();
    const transport = new InProcessTransport(relay, envelopeUrl);
    const client = new Client({ dsn: 'https://abc@relay.test/1', transport });
    for (let i = 0; i < 5; i++) client.captureMessage(`m${i}`);
    await client.flush();
    expect(appends.length).toBe(5);
  });
});
