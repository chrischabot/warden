import { describe, expect, test } from 'bun:test';
import { NotificationDispatcher, RecordingTransport } from '../src/dispatcher';
import type { Notification } from '../src/types';

const n: Notification = {
  kind: 'metric-alert',
  severity: 'warning',
  title: 'p95 latency spike',
  body: 'p95 crossed 500ms over 5m window.',
  projectSlug: 'api',
  links: [{ label: 'Dashboard', url: 'https://sentry.example.com/d/api' }],
  occurrenceAt: 1_700_000_000_000,
};

describe('NotificationDispatcher', () => {
  test('dispatches to multiple channels in order', async () => {
    const transport = new RecordingTransport();
    const dispatcher = new NotificationDispatcher(transport);
    const payloads = await dispatcher.dispatch(n, [
      { kind: 'slack', options: { target: '#oncall' } },
      { kind: 'webhook', options: { target: 'https://hook' } },
      { kind: 'email', options: { target: 'oncall@example.com' } },
    ]);
    expect(payloads.length).toBe(3);
    expect(transport.delivered.length).toBe(3);
    expect(transport.delivered.map((p) => p.channel)).toEqual(['slack', 'webhook', 'email']);
  });

  test('propagates transport errors', async () => {
    class FailingTransport {
      async deliver(): Promise<void> {
        throw new Error('boom');
      }
    }
    const dispatcher = new NotificationDispatcher(new FailingTransport());
    await expect(
      dispatcher.dispatch(n, [{ kind: 'slack', options: { target: '#x' } }]),
    ).rejects.toThrow('boom');
  });

  test('empty target list is a no-op', async () => {
    const transport = new RecordingTransport();
    const dispatcher = new NotificationDispatcher(transport);
    const payloads = await dispatcher.dispatch(n, []);
    expect(payloads.length).toBe(0);
    expect(transport.delivered.length).toBe(0);
  });
});
