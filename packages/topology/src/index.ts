/**
 * Dynamic process-topology sizing for sentry-replica.
 *
 * Single source of truth for every shard/worker count in the system.
 * Encodes the §12.2 sizing formulas from the spec with a 1-process
 * floor on each division, so the same compiled code runs on:
 *
 *   - a 4-core laptop      (~24 procs)
 *   - an 8-core sandbox    (~33 procs)
 *   - a 16-core staging    (~51 procs)
 *   - a 32-core production (~91 procs)
 *   - a 64-core large host (~171 procs)
 *
 * Resolution of the §2.5 / §12.2 spec inconsistency (user steer
 * 2026-05-16): columnar_shards = number of logical cores, dynamic
 * per host. See SPEC-CORRECTIONS.md §1.
 */

import * as os from 'node:os';

/** Inputs for computing topology. Cores defaults to detected. */
export interface TopologyInputs {
  /** Logical CPU cores. If omitted, auto-detected via os.cpus(). */
  cores?: number;
  /** Number of projects in the metadata store. Drives alert_evaluators. */
  projects?: number;
  /** Number of uptime monitors configured. Drives uptime_probers. */
  monitors?: number;
}

/** Frozen sizing snapshot. */
export interface Topology {
  readonly cores: number;
  readonly projects: number;
  readonly monitors: number;

  // §12.2 formulas, with max(1, ...) floor on each division.
  readonly relayProcs: number;
  readonly columnarShards: number;
  readonly queueShards: number;
  readonly metadataShards: number;
  readonly ingestWorkers: number;
  readonly compactionWorkers: number;
  readonly queryWorkers: number;
  readonly apiProcs: number;
  readonly wsFanoutProcs: number;
  readonly alertCoordinator: number;
  readonly alertEvaluators: number;
  readonly seerWorkers: number;
  readonly cronLeader: number;
  readonly uptimeProbers: number;

  /** Sum of every CPU-or-IO-bound process kind on this host. */
  readonly totalProcs: number;
}

/**
 * Detect logical CPU count.
 *
 * Bun ships `os.cpus()` Node-compatibly. Falls back to
 * `navigator.hardwareConcurrency` in restricted runtimes
 * (Workers, Deno without --allow-sys) and finally to 1.
 */
export function detectCores(): number {
  try {
    const cpus = os.cpus?.();
    if (Array.isArray(cpus) && cpus.length > 0) return cpus.length;
  } catch {
    // os.cpus() unavailable; fall through.
  }
  const nav = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator;
  if (nav?.hardwareConcurrency && nav.hardwareConcurrency > 0) {
    return nav.hardwareConcurrency;
  }
  return 1;
}

/** Build a topology from explicit or auto-detected inputs. */
export function computeTopology(inputs: TopologyInputs = {}): Topology {
  const cores = inputs.cores ?? detectCores();
  const projects = inputs.projects ?? 0;
  const monitors = inputs.monitors ?? 0;

  if (!Number.isFinite(cores) || cores < 1) {
    throw new RangeError(`computeTopology: cores must be an integer >= 1, got ${cores}`);
  }
  if (!Number.isFinite(projects) || projects < 0) {
    throw new RangeError(`computeTopology: projects must be >= 0, got ${projects}`);
  }
  if (!Number.isFinite(monitors) || monitors < 0) {
    throw new RangeError(`computeTopology: monitors must be >= 0, got ${monitors}`);
  }

  // Integer floor-divide with a 1-process floor. Guarantees that
  // even a 1-core host gets one of every shard/worker kind.
  const floorDiv = (n: number, d: number): number => Math.max(1, Math.floor(n / d));

  const relayProcs = Math.max(2, floorDiv(cores, 8));
  const columnarShards = cores;
  const queueShards = floorDiv(cores, 4);
  const metadataShards = floorDiv(cores, 4);
  const ingestWorkers = floorDiv(cores, 4);
  const compactionWorkers = floorDiv(cores, 4);
  const queryWorkers = floorDiv(cores, 4);
  const apiProcs = Math.max(2, floorDiv(cores, 8));
  const wsFanoutProcs = 2;
  const alertCoordinator = 1;
  const alertEvaluators = Math.max(4, Math.ceil(projects / 100));
  const seerWorkers = 1;
  const cronLeader = 1;
  const uptimeProbers = Math.max(2, Math.ceil(monitors / 500));

  const totalProcs =
    relayProcs +
    columnarShards +
    queueShards +
    metadataShards +
    ingestWorkers +
    compactionWorkers +
    queryWorkers +
    apiProcs +
    wsFanoutProcs +
    alertCoordinator +
    alertEvaluators +
    seerWorkers +
    cronLeader +
    uptimeProbers;

  return Object.freeze({
    cores,
    projects,
    monitors,
    relayProcs,
    columnarShards,
    queueShards,
    metadataShards,
    ingestWorkers,
    compactionWorkers,
    queryWorkers,
    apiProcs,
    wsFanoutProcs,
    alertCoordinator,
    alertEvaluators,
    seerWorkers,
    cronLeader,
    uptimeProbers,
    totalProcs,
  });
}

/** Coarse host tier for logging and dashboards. */
export type Tier = '1-core' | '4-core' | '8-core' | '16-core' | '32-core' | '64-core' | 'large';

export function tierFor(cores: number): Tier {
  if (cores <= 1) return '1-core';
  if (cores <= 4) return '4-core';
  if (cores <= 8) return '8-core';
  if (cores <= 16) return '16-core';
  if (cores <= 32) return '32-core';
  if (cores <= 64) return '64-core';
  return 'large';
}

/** One-line summary suitable for startup logs and operator output. */
export function summarize(t: Topology): string {
  return (
    `topology: cores=${t.cores} tier=${tierFor(t.cores)} ` +
    `relay=${t.relayProcs} ` +
    `columnar=${t.columnarShards} ` +
    `queue=${t.queueShards} ` +
    `metadata=${t.metadataShards} ` +
    `ingest=${t.ingestWorkers} ` +
    `compactor=${t.compactionWorkers} ` +
    `query=${t.queryWorkers} ` +
    `api=${t.apiProcs} ` +
    `ws=${t.wsFanoutProcs} ` +
    `alert=${t.alertCoordinator}+${t.alertEvaluators} ` +
    `seer=${t.seerWorkers} ` +
    `cron=${t.cronLeader} ` +
    `uptime=${t.uptimeProbers} ` +
    `total=${t.totalProcs}`
  );
}

/**
 * Cached default topology computed from the host at first call.
 * Most subsystems will use this; explicit `computeTopology` is for
 * tests, simulations, and the operator CLI.
 */
let _default: Topology | undefined;
export function defaultTopology(): Topology {
  if (!_default) {
    _default = computeTopology({});
  }
  return _default;
}

/** Reset the cached default. Test-only. */
export function _resetDefaultForTests(): void {
  _default = undefined;
}
