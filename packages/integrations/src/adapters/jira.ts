/**
 * Jira Cloud REST v3 issue-creation adapter.
 *
 * Body shape: `{ fields: { project: {key}, issuetype: {name},
 * summary, description: { ADF }, priority: {name}, labels } }`.
 *
 * The `target` is `PROJECT_KEY`. Config may include
 * `issueType` (default "Task") and `priority`.
 */

import type { AdapterOptions, ChannelAdapter, Notification, OutboundPayload } from '../types';

const SEVERITY_TO_PRIORITY: Readonly<Record<Notification['severity'], string>> = Object.freeze({
  fatal: 'Highest',
  error: 'High',
  warning: 'Medium',
  info: 'Low',
});

export const JiraAdapter: ChannelAdapter = {
  kind: 'jira',
  format(notification: Notification, options: AdapterOptions): OutboundPayload {
    const issueType = (options.config?.['issueType'] as string | undefined) ?? 'Task';
    const priority =
      (options.config?.['priority'] as string | undefined) ??
      SEVERITY_TO_PRIORITY[notification.severity];

    const adfParagraphs: unknown[] = [];
    adfParagraphs.push(paragraph(notification.body));
    if (notification.facts) {
      for (const f of notification.facts) {
        adfParagraphs.push(paragraph(`${f.label}: ${f.value}`));
      }
    }
    if (notification.links.length > 0) {
      for (const link of notification.links) {
        adfParagraphs.push({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: link.label,
              marks: [{ type: 'link', attrs: { href: link.url } }],
            },
          ],
        });
      }
    }

    const body = {
      fields: {
        project: { key: options.target },
        issuetype: { name: issueType },
        summary: notification.title,
        description: {
          type: 'doc',
          version: 1,
          content: adfParagraphs,
        },
        priority: { name: priority },
        labels: ['sentry-replica', notification.projectSlug],
      },
    };
    return {
      channel: 'jira',
      target: options.target,
      contentType: 'application/json',
      body: JSON.stringify(body),
    };
  },
};

function paragraph(text: string): unknown {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}
