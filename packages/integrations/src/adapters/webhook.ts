/**
 * Generic JSON webhook adapter.
 *
 * Renders the notification verbatim as a JSON object with stable
 * field names — this is the integration users hook into when they
 * build their own internal routing.
 */

import type { AdapterOptions, ChannelAdapter, Notification, OutboundPayload } from '../types';

export const WebhookAdapter: ChannelAdapter = {
  kind: 'webhook',
  format(notification: Notification, options: AdapterOptions): OutboundPayload {
    const body = JSON.stringify({
      kind: notification.kind,
      severity: notification.severity,
      title: notification.title,
      body: notification.body,
      project: notification.projectSlug,
      environment: notification.environment,
      release: notification.release,
      fingerprint: notification.fingerprint,
      links: notification.links,
      facts: notification.facts ?? [],
      occurred_at: new Date(notification.occurrenceAt).toISOString(),
    });
    return {
      channel: 'webhook',
      target: options.target,
      contentType: 'application/json',
      body,
    };
  },
};
