/**
 * Node / Bun process-level error capture.
 *
 * `installNodeErrorHandlers()` registers `uncaughtException` and
 * `unhandledRejection` listeners on the global `process` object,
 * routing thrown errors to the current Hub for capture.
 *
 * Idempotent. Returns an `uninstall` function for graceful teardown
 * in tests.
 *
 * Runtime safety: if `process` is missing (Cloudflare Workers,
 * Deno without polyfills, browser), this is a no-op.
 */

import { getCurrentHub } from '../hub';

export interface InstalledNodeHandlers {
  uninstall(): void;
}

let installed = false;
let uncaughtListener: ((err: Error) => void) | undefined;
let unhandledListener: ((reason: unknown) => void) | undefined;

export function installNodeErrorHandlers(): InstalledNodeHandlers {
  const proc = (globalThis as { process?: NodeProcess }).process;
  if (!proc || typeof proc.on !== 'function') {
    return { uninstall: () => {} };
  }
  if (installed) return { uninstall: () => uninstallNodeErrorHandlers() };

  uncaughtListener = (err: Error): void => {
    try {
      getCurrentHub().captureException(err, { level: 'fatal' });
    } catch {
      // Never throw from a process error listener.
    }
  };
  unhandledListener = (reason: unknown): void => {
    try {
      getCurrentHub().captureException(reason, { level: 'error' });
    } catch {
      // Never throw from a process error listener.
    }
  };

  proc.on('uncaughtException', uncaughtListener);
  proc.on('unhandledRejection', unhandledListener);
  installed = true;
  return { uninstall: () => uninstallNodeErrorHandlers() };
}

export function uninstallNodeErrorHandlers(): void {
  const proc = (globalThis as { process?: NodeProcess }).process;
  if (!proc) {
    installed = false;
    return;
  }
  if (uncaughtListener && typeof proc.removeListener === 'function') {
    proc.removeListener('uncaughtException', uncaughtListener);
  }
  if (unhandledListener && typeof proc.removeListener === 'function') {
    proc.removeListener('unhandledRejection', unhandledListener);
  }
  uncaughtListener = undefined;
  unhandledListener = undefined;
  installed = false;
}

interface NodeProcess {
  on(event: 'uncaughtException', listener: (err: Error) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  removeListener?: {
    (event: 'uncaughtException', listener: (err: Error) => void): unknown;
    (event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  };
}
