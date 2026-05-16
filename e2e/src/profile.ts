/**
 * Per-stage profiler. Runs each hot-path stage in isolation
 * against a representative event payload and reports ns/iter.
 */

import { encodeEnvelope, parseEnvelopeStream } from '@sr/proto';
import { eventFromException, eventToItemPayload } from '@sr/sdk-javascript';
import { Pipeline } from './pipeline';

const ITERS = 5_000;

function ns(): number {
  return Number(Bun.nanoseconds());
}

function bench(label: string, iters: number, fn: () => void | Promise<void>): Promise<void> {
  return (async () => {
    // Warmup
    for (let i = 0; i < 200; i++) await fn();
    const t0 = ns();
    for (let i = 0; i < iters; i++) await fn();
    const t1 = ns();
    const nsPerIter = (t1 - t0) / iters;
    const opsPerSec = 1e9 / nsPerIter;
    console.log(
      `  ${label.padEnd(36)} ${nsPerIter.toFixed(0).padStart(8)} ns/iter   ${opsPerSec
        .toFixed(0)
        .padStart(10)} ops/s`,
    );
  })();
}

async function main(): Promise<void> {
  // Representative error similar to load.ts synthetic errors.
  const err = new Error('LoadError #7: synthetic');
  err.name = 'LoadError7';
  err.stack = `${err.name}: synthetic\n    at handler7 (src/handler.ts:17:1)`;

  // 1. SDK event-from-exception (includes stack parsing)
  await bench('SDK eventFromException', ITERS, () => {
    eventFromException(err);
  });

  // 2. SDK event → item payload (JSON.stringify + utf8 encode)
  const ev0 = eventFromException(err);
  await bench('SDK eventToItemPayload', ITERS, () => {
    eventToItemPayload(ev0);
  });

  // 3. encodeEnvelope (full envelope)
  const item0 = eventToItemPayload(ev0);
  await bench('encodeEnvelope (1 item)', ITERS, () => {
    encodeEnvelope({
      header: { event_id: 'aaaa' },
      items: [{ header: { type: 'event', length: item0.payload.byteLength }, payload: item0.payload }],
    });
  });

  // 4. parseEnvelopeStream (the streaming parser)
  const envelopeBytes = encodeEnvelope({
    header: { event_id: 'aaaa' },
    items: [{ header: { type: 'event', length: item0.payload.byteLength }, payload: item0.payload }],
  });
  await bench('parseEnvelopeStream (1 item)', ITERS, async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(envelopeBytes);
        controller.close();
      },
    });
    // Drain.
    for await (const _ev of parseEnvelopeStream(stream)) {
      // count nothing
    }
  });

  // 5. Full relay.fetch (handler hot path) — bypass SDK, hit relay directly.
  const pipeline = new Pipeline();
  const url = 'http://relay.local/api/1/envelope/';
  await bench('relay.fetch (1-item envelope)', ITERS, async () => {
    await pipeline.relay.fetch(
      new Request(url, { method: 'POST', body: envelopeBytes as BodyInit }),
    );
  });
  pipeline.queue.drainAll(); // discard buffered records

  // 6. SDK client.captureException → transport.send → relay.fetch (full path)
  const client = pipeline.sdkClient('1');
  await bench('SDK captureException (full)', ITERS, () => {
    client.captureException(err);
  });
  await client.flush();
  pipeline.queue.drainAll();

  // 7. Pipeline drain (fingerprint + store).
  // Seed the queue with N records first, then time the drain.
  const drainBudget = 1000;
  for (let i = 0; i < drainBudget; i++) {
    client.captureException(err);
  }
  await client.flush();
  const drainT0 = ns();
  pipeline.drain();
  const drainT1 = ns();
  console.log(
    `  pipeline.drain (per record)         ${((drainT1 - drainT0) / drainBudget).toFixed(0).padStart(8)} ns/iter   ${(
      1e9 / ((drainT1 - drainT0) / drainBudget)
    ).toFixed(0).padStart(10)} ops/s`,
  );
}

if (import.meta.main) {
  console.log('Per-stage profile (lower ns/iter = faster):');
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}