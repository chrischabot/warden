import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '../src/client';
import { getCurrentHub, Hub, setCurrentHub } from '../src/hub';
import { installNodeErrorHandlers, uninstallNodeErrorHandlers } from '../src/integrations/node';
import { NoopTransport } from '../src/transport';

afterEach(() => {
  uninstallNodeErrorHandlers();
});

describe('installNodeErrorHandlers', () => {
  test('installs and uninstalls listeners idempotently', () => {
    const a = installNodeErrorHandlers();
    const b = installNodeErrorHandlers();
    // Second call is a no-op; both return an uninstall handle.
    expect(typeof a.uninstall).toBe('function');
    expect(typeof b.uninstall).toBe('function');
    a.uninstall();
  });

  test('uncaughtException routes to the current Hub', () => {
    const original = getCurrentHub();
    const transport = new NoopTransport();
    const client = new Client({ dsn: 'https://abc@relay.test/1', transport });
    const hub = new Hub(client);
    setCurrentHub(hub);
    try {
      installNodeErrorHandlers();
      // Synthesise an uncaughtException by directly invoking the
      // listener — emitting through process.emit('uncaughtException')
      // would terminate the Bun test runner.
      type ProcessLike = {
        listeners(event: string): Array<(err: Error) => void>;
      };
      const proc = (globalThis as { process?: ProcessLike }).process;
      const listeners = proc?.listeners('uncaughtException') ?? [];
      const last = listeners[listeners.length - 1];
      expect(typeof last).toBe('function');
      last?.(new Error('uncaught'));
      expect(transport.sent.length).toBe(1);
    } finally {
      setCurrentHub(original);
    }
  });

  test('unhandledRejection routes to the current Hub', () => {
    const original = getCurrentHub();
    const transport = new NoopTransport();
    const client = new Client({ dsn: 'https://abc@relay.test/1', transport });
    const hub = new Hub(client);
    setCurrentHub(hub);
    try {
      installNodeErrorHandlers();
      type ProcessLike = {
        listeners(event: string): Array<(reason: unknown) => void>;
      };
      const proc = (globalThis as { process?: ProcessLike }).process;
      const listeners = proc?.listeners('unhandledRejection') ?? [];
      const last = listeners[listeners.length - 1];
      last?.(new Error('rejected'));
      expect(transport.sent.length).toBe(1);
    } finally {
      setCurrentHub(original);
    }
  });
});
