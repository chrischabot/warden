/**
 * Email adapter — plain-text body. Production wiring substitutes
 * an HTML renderer (Sentry uses MJML); this first cut keeps it
 * simple so the formatter is pure and deterministic.
 */

import type { AdapterOptions, ChannelAdapter, Notification, OutboundPayload } from '../types';

export const EmailAdapter: ChannelAdapter = {
  kind: 'email',
  format(notification: Notification, options: AdapterOptions): OutboundPayload {
    const lines: string[] = [];
    lines.push(`Subject: [${notification.severity.toUpperCase()}] ${notification.title}`);
    lines.push('');
    lines.push(notification.body);
    lines.push('');
    lines.push(`Project: ${notification.projectSlug}`);
    if (notification.environment) lines.push(`Environment: ${notification.environment}`);
    if (notification.release) lines.push(`Release: ${notification.release}`);
    if (notification.facts) {
      for (const f of notification.facts) {
        lines.push(`${f.label}: ${f.value}`);
      }
    }
    if (notification.links.length > 0) {
      lines.push('');
      lines.push('Links:');
      for (const link of notification.links) {
        lines.push(`  - ${link.label}: ${link.url}`);
      }
    }
    return {
      channel: 'email',
      target: options.target,
      contentType: 'text/plain; charset=utf-8',
      body: lines.join('\n'),
    };
  },
};
