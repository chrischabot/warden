/**
 * Relay entry point.
 *
 * `createRelay(deps)` returns a fetch-handler suitable for either
 * unit tests or production. `startRelay(deps, port)` is the
 * production launcher: it wraps the handler in `Bun.serve` with
 * `reusePort: true`, so multiple OS processes can share the same
 * port and let the kernel load-balance.
 *
 * Per spec §3.1 the relay proc count is `max(2, cores / 8)` —
 * we don't fork here; orchestration (supervisord, systemd, the
 * supervisor process per §12.5) spawns N relay processes, each of
 * which calls `startRelay` with the same port and `reusePort`.
 */

import { defaultTopology } from '@sr/topology';
import { createRelay, type RelayDeps, type RelayHandler } from './handler';

export type { RelayDeps, RelayHandler, RelayQueue } from './handler';
export { createRelay };

export interface RelayServerOptions {
  readonly port?: number;
  readonly hostname?: string;
  /** 100 MiB to accommodate minidump attachments per spec §3.1. */
  readonly maxRequestBodySize?: number;
  readonly idleTimeoutSeconds?: number;
}

export interface RelayServer {
  readonly url: string;
  stop(): Promise<void>;
}

/**
 * Start a Bun.serve instance for production. Returns the server
 * handle so the caller can stop it for graceful shutdown.
 */
export function startRelay(deps: RelayDeps, options: RelayServerOptions = {}): RelayServer {
  const handler = createRelay(deps);
  const port = options.port ?? 9000;
  const server = Bun.serve({
    port,
    hostname: options.hostname ?? '0.0.0.0',
    reusePort: true,
    maxRequestBodySize: options.maxRequestBodySize ?? 100 * 1024 * 1024,
    idleTimeout: options.idleTimeoutSeconds ?? 30,
    fetch: handler.fetch,
  });
  return {
    url: server.url.toString(),
    async stop(): Promise<void> {
      server.stop();
    },
  };
}

/** Process entry for `bun src/index.ts`. */
if (import.meta.main) {
  const t = defaultTopology();
  // eslint-disable-next-line no-console
  console.log(`[sr-relay] starting; topology cores=${t.cores} relayProcs=${t.relayProcs}`);
  // No queue dependency wired here yet — production wiring happens
  // when the orchestrator spawns relay procs in Ring 2 closure.
  throw new Error('Production entry point requires a queue dep injected by the orchestrator.');
}
