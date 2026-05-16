/**
 * OpsGenie alert creation adapter.
 *
 * Body shape: `{ message, alias, description, priority, tags,
 * details }`. `options.target` is the API team identifier.
 */

import type { AdapterOptions, ChannelAdapter, Notification, OutboundPayload } from '../types';

const PRIORITY_MAP: Readonly<Record<Notification['severity'], string>> = Object.freeze({
  fatal: 'P1',
  error: 'P2',
  warning: 'P3',
  info: 'P5',
});

export const OpsGenieAdapter: ChannelAdapter = {
  kind: 'opsgenie',
  format(notification: Notification, options: AdapterOptions): OutboundPayload {
    const alias = notification.fingerprint ?? `${notification.projectSlug}:${notification.title}`;
    const body = {
      message: notification.title,
      alias,
      description: notification.body,
      priority: PRIORITY_MAP[notification.severity],
      tags: [notification.projectSlug, notification.kind].concat(
        notification.environment ? [notification.environment] : [],
      ),
      details: {
        environment: notification.environment,
        release: notification.release,
        facts: notification.facts,
        links: notification.links,
      },
      responders: options.config?.['teamName']
        ? [{ name: options.config?.['teamName'] as string, type: 'team' }]
        : undefined,
    };
    return {
      channel: 'opsgenie',
      target: options.target,
      contentType: 'application/json',
      body: JSON.stringify(body),
    };
  },
};
