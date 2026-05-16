/**
 * Slack adapter — Block Kit-shaped JSON.
 *
 * Emits a header block, optional context block (release / env),
 * one fact block per `facts` entry, and an actions block with each
 * notification link.
 */

import type { AdapterOptions, ChannelAdapter, Notification, OutboundPayload } from '../types';

const SEVERITY_COLOR: Readonly<Record<Notification['severity'], string>> = Object.freeze({
  fatal: '#990000',
  error: '#d63031',
  warning: '#fdcb6e',
  info: '#0984e3',
});

export const SlackAdapter: ChannelAdapter = {
  kind: 'slack',
  format(notification: Notification, options: AdapterOptions): OutboundPayload {
    const blocks: unknown[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${prefix(notification)} ${notification.title}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: notification.body },
      },
    ];

    const ctxFields: string[] = [];
    if (notification.environment) ctxFields.push(`env: ${notification.environment}`);
    if (notification.release) ctxFields.push(`release: ${notification.release}`);
    ctxFields.push(`project: ${notification.projectSlug}`);
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: ctxFields.join('  |  ') }],
    });

    if (notification.facts && notification.facts.length > 0) {
      blocks.push({
        type: 'section',
        fields: notification.facts.map((f) => ({
          type: 'mrkdwn',
          text: `*${f.label}*\n${f.value}`,
        })),
      });
    }

    if (notification.links.length > 0) {
      blocks.push({
        type: 'actions',
        elements: notification.links.map((l) => ({
          type: 'button',
          text: { type: 'plain_text', text: l.label },
          url: l.url,
        })),
      });
    }

    const body = JSON.stringify({
      attachments: [
        {
          color: SEVERITY_COLOR[notification.severity],
          blocks,
        },
      ],
    });

    return {
      channel: 'slack',
      target: options.target,
      contentType: 'application/json',
      body,
    };
  },
};

function prefix(n: Notification): string {
  switch (n.severity) {
    case 'fatal':
      return '[FATAL]';
    case 'error':
      return '[ERROR]';
    case 'warning':
      return '[WARN]';
    case 'info':
      return '[INFO]';
  }
}
