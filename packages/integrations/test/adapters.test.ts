import { describe, expect, test } from 'bun:test';
import {
  adapter,
  EmailAdapter,
  GitHubAdapter,
  JiraAdapter,
  OpsGenieAdapter,
  PagerDutyAdapter,
  SlackAdapter,
  WebhookAdapter,
} from '../src/adapters/index';
import type { Notification } from '../src/types';

function notif(overrides: Partial<Notification> = {}): Notification {
  return {
    kind: 'issue-alert',
    severity: 'error',
    title: 'TypeError: cannot read property "x" of undefined',
    body: 'Issue PROJ-42 has exceeded its alert threshold.',
    projectSlug: 'web',
    environment: 'production',
    release: 'v1.2.3',
    fingerprint: 'abc123fingerprint',
    links: [{ label: 'View Issue', url: 'https://sentry.example.com/issues/42' }],
    facts: [
      { label: 'Events/min', value: '42' },
      { label: 'Users affected', value: '7' },
    ],
    occurrenceAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('SlackAdapter', () => {
  test('emits valid Block Kit JSON', () => {
    const out = SlackAdapter.format(notif(), { target: '#oncall' });
    expect(out.channel).toBe('slack');
    expect(out.contentType).toBe('application/json');
    const body = JSON.parse(out.body);
    expect(Array.isArray(body.attachments)).toBe(true);
    const blocks = body.attachments[0].blocks;
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].text.text).toContain('[ERROR]');
  });

  test('color matches severity', () => {
    const fatal = JSON.parse(
      SlackAdapter.format(notif({ severity: 'fatal' }), { target: '#x' }).body,
    );
    expect(fatal.attachments[0].color).toBe('#990000');
  });

  test('facts render as a section', () => {
    const out = SlackAdapter.format(notif(), { target: '#x' });
    const blocks = JSON.parse(out.body).attachments[0].blocks;
    const factsBlock = blocks.find((b: { fields?: unknown[] }) => Array.isArray(b.fields));
    expect(factsBlock).toBeDefined();
    expect(factsBlock.fields.length).toBe(2);
  });
});

describe('WebhookAdapter', () => {
  test('renders neutral JSON', () => {
    const out = WebhookAdapter.format(notif(), { target: 'https://hook.example.com' });
    const body = JSON.parse(out.body);
    expect(body.kind).toBe('issue-alert');
    expect(body.severity).toBe('error');
    expect(body.project).toBe('web');
    expect(body.occurred_at).toBe('2023-11-14T22:13:20.000Z');
  });
});

describe('EmailAdapter', () => {
  test('produces a Subject + body', () => {
    const out = EmailAdapter.format(notif(), { target: 'oncall@example.com' });
    expect(out.contentType).toBe('text/plain; charset=utf-8');
    expect(out.body).toContain('Subject: [ERROR]');
    expect(out.body).toContain('Project: web');
    expect(out.body).toContain('Events/min: 42');
    expect(out.body).toContain('View Issue: https://sentry.example.com/issues/42');
  });
});

describe('GitHubAdapter', () => {
  test('produces an issue body with markdown', () => {
    const out = GitHubAdapter.format(notif(), {
      target: 'igentai/sentry-replica',
      config: { labels: ['bug', 'sentry'] },
    });
    const body = JSON.parse(out.body);
    expect(body.title).toContain('TypeError');
    expect(body.labels).toEqual(['bug', 'sentry']);
    expect(body.body).toContain('**Project:**');
    expect(body.body).toContain('[View Issue](https://sentry.example.com/issues/42)');
  });

  test('falls back to default labels when config omits them', () => {
    const out = GitHubAdapter.format(notif(), { target: 'o/r' });
    expect(JSON.parse(out.body).labels).toEqual(['sentry-replica']);
  });
});

describe('JiraAdapter', () => {
  test('builds ADF document with issuetype+priority', () => {
    const out = JiraAdapter.format(notif(), { target: 'WEB' });
    const body = JSON.parse(out.body);
    expect(body.fields.project.key).toBe('WEB');
    expect(body.fields.issuetype.name).toBe('Task');
    expect(body.fields.priority.name).toBe('High');
    expect(body.fields.description.type).toBe('doc');
  });

  test('config can override issuetype + priority', () => {
    const out = JiraAdapter.format(notif(), {
      target: 'WEB',
      config: { issueType: 'Bug', priority: 'Critical' },
    });
    const body = JSON.parse(out.body);
    expect(body.fields.issuetype.name).toBe('Bug');
    expect(body.fields.priority.name).toBe('Critical');
  });

  test('priority defaults map severity to Jira scale', () => {
    const body = JSON.parse(JiraAdapter.format(notif({ severity: 'fatal' }), { target: 'X' }).body);
    expect(body.fields.priority.name).toBe('Highest');
  });
});

describe('PagerDutyAdapter', () => {
  test('emits Events API v2 trigger payload', () => {
    const out = PagerDutyAdapter.format(notif(), { target: 'routing-key-here' });
    const body = JSON.parse(out.body);
    expect(body.routing_key).toBe('routing-key-here');
    expect(body.event_action).toBe('trigger');
    expect(body.dedup_key).toBe('abc123fingerprint');
    expect(body.payload.severity).toBe('error');
    expect(body.payload.source).toBe('web');
  });

  test('hashes a dedup key when fingerprint is absent', () => {
    const { fingerprint: _fp, ...withoutFp } = notif();
    const noFp = JSON.parse(
      PagerDutyAdapter.format(withoutFp as Notification, { target: 'r' }).body,
    );
    expect(typeof noFp.dedup_key).toBe('string');
    expect(noFp.dedup_key.length).toBe(16);
  });
});

describe('OpsGenieAdapter', () => {
  test('emits alert with priority map and tags', () => {
    const out = OpsGenieAdapter.format(notif(), {
      target: 'team-id',
      config: { teamName: 'oncall' },
    });
    const body = JSON.parse(out.body);
    expect(body.message).toContain('TypeError');
    expect(body.priority).toBe('P2');
    expect(body.tags).toContain('web');
    expect(body.tags).toContain('production');
    expect(body.responders).toEqual([{ name: 'oncall', type: 'team' }]);
  });

  test('alias falls back to project:title when fingerprint absent', () => {
    const { fingerprint: _fp, ...withoutFp } = notif();
    const out = OpsGenieAdapter.format(withoutFp as Notification, { target: 't' });
    const body = JSON.parse(out.body);
    expect(body.alias).toBe(`web:${notif().title}`);
  });
});

describe('adapter registry', () => {
  test('every ChannelKind is registered', () => {
    expect(adapter('slack').kind).toBe('slack');
    expect(adapter('webhook').kind).toBe('webhook');
    expect(adapter('email').kind).toBe('email');
    expect(adapter('github').kind).toBe('github');
    expect(adapter('jira').kind).toBe('jira');
    expect(adapter('pagerduty').kind).toBe('pagerduty');
    expect(adapter('opsgenie').kind).toBe('opsgenie');
  });
});
