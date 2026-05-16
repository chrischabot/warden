/**
 * SDK transport that pumps envelopes straight into a `RelayHandler`'s
 * `fetch()` without going over the network. Lets us drive an actual
 * SDK Client end-to-end without binding a real port — the relay is
 * just invoked synchronously per send.
 *
 * Flush is snapshot-and-await: capture the current inflight list,
 * clear it, await `Promise.allSettled` on the snapshot. New sends
 * arriving during the await accumulate into the cleared list and
 * are handled by a subsequent flush.
 */

import type { RelayHandler } from '@sr/app-relay';
import type { Transport } from '@sr/sdk-javascript';

export class InProcessTransport implements Transport {
  readonly responses: Response[] = [];
  private inflight: Array<Promise<unknown>> = [];

  constructor(
    public readonly relay: RelayHandler,
    public readonly envelopeUrl: string,
  ) {}

  async send(envelope: Uint8Array): Promise<void> {
    const req = new Request(this.envelopeUrl, {
      method: 'POST',
      body: envelope as BodyInit,
    });
    const p = this.relay.fetch(req).then((r) => {
      this.responses.push(r);
    });
    this.inflight.push(p);
    await Promise.resolve();
  }

  async flush(_timeoutMs?: number): Promise<boolean> {
    if (this.inflight.length === 0) return true;
    const snapshot = this.inflight;
    this.inflight = [];
    await Promise.allSettled(snapshot);
    // If sends arrived during the await, flush them too.
    if (this.inflight.length > 0) return this.flush();
    return true;
  }
}