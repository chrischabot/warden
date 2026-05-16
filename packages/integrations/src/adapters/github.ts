/**
 * GitHub Issues adapter.
 *
 * Produces a JSON payload matching the GitHub REST API's POST
 * `/repos/{owner}/{repo}/issues` body: `{ title, body, labels }`.
 *
 * The `target` is interpreted as `owner/repo`. Config may carry
 * a `labels` array.
 */

import type { AdapterOptions, ChannelAdapter, Notification, OutboundPayload } from '../types';

export const GitHubAdapter: ChannelAdapter = {
  kind: 'github',
  format(notification: Notification, options: AdapterOptions): OutboundPayload {
    const labels = Array.isArray(options.config?.['labels'])
      ? (options.config?.['labels'] as string[])
      : ['sentry-replica'];
    const bodyLines: string[] = [];
    bodyLines.push(notification.body);
    bodyLines.push('');
    bodyLines.push(`**Project:** \`${notification.projectSlug}\``);
    if (notification.environment)
      bodyLines.push(`**Environment:** \`${notification.environment}\``);
    if (notification.release) bodyLines.push(`**Release:** \`${notification.release}\``);
    if (notification.fingerprint) {
      bodyLines.push(`**Fingerprint:** \`${notification.fingerprint}\``);
    }
    if (notification.facts) {
      bodyLines.push('');
      for (const f of notification.facts) {
        bodyLines.push(`- **${f.label}:** ${f.value}`);
      }
    }
    if (notification.links.length > 0) {
      bodyLines.push('');
      for (const link of notification.links) {
        bodyLines.push(`- [${link.label}](${link.url})`);
      }
    }
    return {
      channel: 'github',
      target: options.target,
      contentType: 'application/json',
      body: JSON.stringify({
        title: notification.title,
        body: bodyLines.join('\n'),
        labels,
      }),
    };
  },
};
