/**
 * Notification dispatcher.
 *
 * Wires the `ChannelAdapter` formatters to an outbound `Transport`.
 * For unit-testing and offline mode, a `RecordingTransport` is
 * provided that just stores the payloads.
 */

import { ADAPTERS } from './adapters/index';
import type { AdapterOptions, ChannelKind, Notification, OutboundPayload } from './types';

export interface Transport {
  deliver(payload: OutboundPayload): Promise<void>;
}

export interface ChannelTarget {
  readonly kind: ChannelKind;
  readonly options: AdapterOptions;
}

export class NotificationDispatcher {
  constructor(public readonly transport: Transport) {}

  /** Dispatch one notification to one or more channels. */
  async dispatch(
    notification: Notification,
    targets: readonly ChannelTarget[],
  ): Promise<readonly OutboundPayload[]> {
    const out: OutboundPayload[] = [];
    for (const t of targets) {
      const payload = ADAPTERS[t.kind].format(notification, t.options);
      out.push(payload);
      await this.transport.deliver(payload);
    }
    return Object.freeze(out);
  }
}

/** Test transport that records all delivered payloads. */
export class RecordingTransport implements Transport {
  readonly delivered: OutboundPayload[] = [];
  async deliver(payload: OutboundPayload): Promise<void> {
    this.delivered.push(payload);
  }
}
