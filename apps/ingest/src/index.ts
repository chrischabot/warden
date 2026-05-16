/**
 * Ingest entry point. The supervisor (per spec §12.5) spawns
 * `ingestWorkers = floor(cores / 4)` copies of this process, each
 * pulling from a subset of queue shards.
 */

import { defaultTopology } from '@sr/topology';

export * from './worker';

if (import.meta.main) {
  const t = defaultTopology();
  // eslint-disable-next-line no-console
  console.log(`[sr-ingest] starting; topology cores=${t.cores} ingestWorkers=${t.ingestWorkers}`);
  throw new Error(
    'Ingest entry point requires queue + sink dependencies injected by the orchestrator.',
  );
}
