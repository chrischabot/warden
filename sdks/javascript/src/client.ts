/**
 * SDK Client.
 *
 * Holds DSN config, transport, and per-client defaults (release,
 * environment). Capture methods build a full Event, wrap it in a
 * single-item envelope, and hand the bytes to the transport.
 *
 * Trace propagation, Scope/Hub, and integration hooks layer on top
 * of this in subsequent revisions.
 */

import type { Dsn } from '@sr/proto';
import { encodeEnvelope, parseDsn } from '@sr/proto';
import {
  eventFromException,
  eventFromMessage,
  eventToItemPayload,
  newEventId,
  nowIso,
} from './event';
import type { Transport } from './transport';
import { HttpTransport, NoopTransport } from './transport';
import type { CaptureOptions, ClientOptions, Event } from './types';
import { SDK_NAME, SDK_VERSION } from './types';

export class Client {
  readonly options: ClientOptions;
  readonly dsn: Dsn;
  readonly transport: Transport;

  constructor(options: ClientOptions) {
    this.options = options;
    this.dsn = parseDsn(options.dsn);
    this.transport = options.transport ?? new HttpTransport(this.dsn.envelopeUrl);
  }

  /** Capture an exception. Returns the event_id. */
  captureException(err: unknown, options: CaptureOptions = {}): string {
    const ev = eventFromException(err, options);
    return this.captureEvent(ev);
  }

  /** Capture a string message. Returns the event_id. */
  captureMessage(message: string, options: CaptureOptions = {}): string {
    const ev = eventFromMessage(message, { level: 'info', ...options });
    return this.captureEvent(ev);
  }

  /** Capture a pre-built event. Returns the event_id. */
  captureEvent(event: Event): string {
    const finalized = this.applyDefaults(event);
    const item = eventToItemPayload(finalized);
    const envelopeBytes = encodeEnvelope({
      header: {
        event_id: finalized.event_id,
        sent_at: finalized.timestamp ?? nowIso(),
        dsn: this.dsn.envelopeUrl,
        sdk: { name: SDK_NAME, version: SDK_VERSION },
      },
      items: [
        {
          header: { type: item.type, length: item.payload.byteLength },
          payload: item.payload,
        },
      ],
    });
    // Fire-and-forget; transport errors are observable via `flush()`.
    void this.transport.send(envelopeBytes);
    return finalized.event_id;
  }

  /** Wait for in-flight sends to complete. */
  async flush(timeoutMs?: number): Promise<boolean> {
    return this.transport.flush(timeoutMs);
  }

  /** Flush + (transport-specific) cleanup. */
  async close(timeoutMs?: number): Promise<boolean> {
    return this.flush(timeoutMs);
  }

  private applyDefaults(event: Event): Event {
    const out: Event = {
      ...event,
      event_id: event.event_id || newEventId(),
      timestamp: event.timestamp || nowIso(),
    };
    if (this.options.release && !out.release) out.release = this.options.release;
    if (this.options.environment && !out.environment) out.environment = this.options.environment;
    return out;
  }
}

/** Convenience for callers who want a deterministic test transport. */
export function clientWithNoopTransport(dsn: string): { client: Client; transport: NoopTransport } {
  const transport = new NoopTransport();
  const client = new Client({ dsn, transport });
  return { client, transport };
}
