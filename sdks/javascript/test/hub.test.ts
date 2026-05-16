import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { parseEnvelope } from '@sr/proto';
import { Client } from '../src/client';
import { getCurrentHub, Hub, setCurrentHub } from '../src/hub';
import { NoopTransport } from '../src/transport';

const DSN = 'https://abc@relay.test/1';

function newTestHub(): { hub: Hub; transport: NoopTransport } {
  const transport = new NoopTransport();
  const client = new Client({ dsn: DSN, transport });
  const hub = new Hub(client);
  return { hub, transport };
}

describe('Hub — scope stack', () => {
  test('initial scope exists and is reused', () => {
    const { hub } = newTestHub();
    const s1 = hub.getScope();
    const s2 = hub.getScope();
    expect(s1).toBe(s2);
  });

  test('pushScope clones; popScope returns', () => {
    const { hub } = newTestHub();
    hub.getScope().setTag('a', '1');
    const pushed = hub.pushScope();
    expect(pushed.tags.get('a')).toBe('1');
    pushed.setTag('a', '2');
    expect(hub.getScope().tags.get('a')).toBe('2');
    hub.popScope();
    expect(hub.getScope().tags.get('a')).toBe('1');
  });

  test('popScope refuses to pop the root', () => {
    const { hub } = newTestHub();
    hub.popScope();
    hub.popScope();
    expect(hub.getScope()).toBeDefined();
  });

  test('withScope isolates mutations', () => {
    const { hub } = newTestHub();
    hub.getScope().setTag('outer', 'parent');
    hub.withScope((s) => {
      s.setTag('outer', 'child');
      expect(s.tags.get('outer')).toBe('child');
    });
    expect(hub.getScope().tags.get('outer')).toBe('parent');
  });

  test('withScope pops even on throw', () => {
    const { hub } = newTestHub();
    hub.getScope().setTag('a', '1');
    let caught = false;
    try {
      hub.withScope((s) => {
        s.setTag('a', '2');
        throw new Error('boom');
      });
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
    expect(hub.getScope().tags.get('a')).toBe('1');
  });
});

describe('Hub — capture applies scope', () => {
  test('captureException merges scope user + tags into the event', () => {
    const { hub, transport } = newTestHub();
    hub.configureScope((s) => {
      s.setUser({ id: 'u42' }).setTag('request_id', 'rid-1');
    });
    const id = hub.captureException(new Error('boom'));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const env = parseEnvelope(transport.sent[0] as Uint8Array);
    const body = JSON.parse(new TextDecoder().decode(env.items[0]?.payload)) as {
      user: { id: string };
      tags: Record<string, string>;
    };
    expect(body.user.id).toBe('u42');
    expect(body.tags.request_id).toBe('rid-1');
  });

  test('captureException returns empty id with no bound client', () => {
    const hub = new Hub();
    expect(hub.captureException(new Error('x'))).toBe('');
  });

  test('captureMessage defaults level to info', () => {
    const { hub, transport } = newTestHub();
    hub.captureMessage('hello');
    const env = parseEnvelope(transport.sent[0] as Uint8Array);
    const body = JSON.parse(new TextDecoder().decode(env.items[0]?.payload)) as {
      level: string;
    };
    expect(body.level).toBe('info');
  });

  test('captureEvent on an unlevelled event adopts the scope level', () => {
    const { hub, transport } = newTestHub();
    hub.configureScope((s) => s.setLevel('warning'));
    hub.captureEvent({
      event_id: '0'.repeat(32),
      timestamp: '2024-01-01T00:00:00Z',
      message: 'no level',
    });
    const env = parseEnvelope(transport.sent[0] as Uint8Array);
    const body = JSON.parse(new TextDecoder().decode(env.items[0]?.payload)) as {
      level: string;
    };
    expect(body.level).toBe('warning');
  });
});

describe('Hub — singleton helpers', () => {
  let original: Hub;
  beforeEach(() => {
    original = getCurrentHub();
  });
  afterEach(() => {
    setCurrentHub(original);
  });

  test('setCurrentHub replaces; getCurrentHub returns the replacement', () => {
    const fresh = new Hub();
    setCurrentHub(fresh);
    expect(getCurrentHub()).toBe(fresh);
  });
});
