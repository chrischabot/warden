/**
 * PagerDuty Events API v2 adapter.
 *
 * Body shape: `{ routing_key, event_action: 'trigger', dedup_key,
 * payload: { summary, source, severity, timestamp, custom_details } }`.
 *
 * `options.target` is the routing key. Notifications with fingerprint
 * use it as dedup_key; otherwise we hash title+project.
 */

import type { AdapterOptions, ChannelAdapter, Notification, OutboundPayload } from '../types';

const SEVERITY_MAP: Readonly<Record<Notification['severity'], string>> = Object.freeze({
  fatal: 'critical',
  error: 'error',
  warning: 'warning',
  info: 'info',
});

export const PagerDutyAdapter: ChannelAdapter = {
  kind: 'pagerduty',
  format(notification: Notification, options: AdapterOptions): OutboundPayload {
    const dedupKey = notification.fingerprint ?? hashKey(notification);
    const body = {
      routing_key: options.target,
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `${notification.title} (${notification.projectSlug})`,
        source: notification.projectSlug,
        severity: SEVERITY_MAP[notification.severity],
        timestamp: new Date(notification.occurrenceAt).toISOString(),
        custom_details: {
          body: notification.body,
          environment: notification.environment,
          release: notification.release,
          facts: notification.facts,
          links: notification.links,
        },
      },
    };
    return {
      channel: 'pagerduty',
      target: options.target,
      contentType: 'application/json',
      body: JSON.stringify(body),
    };
  },
};

function hashKey(notification: Notification): string {
  const raw = `${notification.kind}|${notification.projectSlug}|${notification.title}`;
  const h = (Bun.hash as (data: string) => bigint)(raw);
  return h.toString(16).padStart(16, '0');
}
