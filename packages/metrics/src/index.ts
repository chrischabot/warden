/**
 * Shared Prometheus metrics scaffold for the `sr_*` namespace.
 *
 * Every binary in the replica imports this and registers its
 * subsystem metrics through these helpers, guaranteeing a single
 * consistent prefix and standard bucket sets for latency and size
 * histograms.
 *
 * Spec §10 mandates a /internal/metrics endpoint per process;
 * `renderText()` provides the text-format body for that endpoint.
 */

import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry, Summary } from 'prom-client';

/** The shared registry. One per process. */
export const registry = new Registry();

/**
 * Standard buckets for latency histograms (seconds).
 * Span: 100 µs to 10 s, log-ish. Good for ingest, query, and IPC
 * latencies that span four orders of magnitude.
 */
export const LATENCY_BUCKETS: readonly number[] = Object.freeze([
  0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10,
]);

/**
 * Standard buckets for size histograms (bytes).
 * Span: 64 B to 64 MiB. Covers envelope items, segment pages, and
 * column chunks.
 */
export const SIZE_BUCKETS: readonly number[] = Object.freeze([
  64, 256, 1024, 4096, 16384, 65536, 262144, 1_048_576, 4_194_304, 16_777_216, 67_108_864,
]);

/**
 * Initialise default Node-style process metrics (CPU, memory, GC,
 * event-loop lag) under the `sr_` prefix, tagged with the
 * subsystem label so every metric is unambiguous in Prometheus.
 */
export function initDefaults(subsystem: string): void {
  collectDefaultMetrics({
    register: registry,
    prefix: 'sr_',
    labels: { subsystem },
  });
}

interface CounterOpts<L extends string> {
  name: string;
  help: string;
  labelNames?: readonly L[];
}

interface GaugeOpts<L extends string> {
  name: string;
  help: string;
  labelNames?: readonly L[];
}

interface HistogramOpts<L extends string> {
  name: string;
  help: string;
  labelNames?: readonly L[];
  buckets?: readonly number[];
}

interface SummaryOpts<L extends string> {
  name: string;
  help: string;
  labelNames?: readonly L[];
  percentiles?: readonly number[];
}

/**
 * Conditional-spread helper. With `exactOptionalPropertyTypes: true`,
 * we must omit `labelNames` entirely when not provided rather than
 * passing `labelNames: undefined`.
 */
function withLabelNames<L extends string>(
  labelNames: readonly L[] | undefined,
): { labelNames: L[] } | Record<string, never> {
  return labelNames ? { labelNames: [...labelNames] } : {};
}

/** Construct a Counter in the `sr_` namespace. */
export function counter<L extends string = string>(opts: CounterOpts<L>): Counter<L> {
  return new Counter<L>({
    name: `sr_${opts.name}`,
    help: opts.help,
    registers: [registry],
    ...withLabelNames(opts.labelNames),
  });
}

/** Construct a Gauge in the `sr_` namespace. */
export function gauge<L extends string = string>(opts: GaugeOpts<L>): Gauge<L> {
  return new Gauge<L>({
    name: `sr_${opts.name}`,
    help: opts.help,
    registers: [registry],
    ...withLabelNames(opts.labelNames),
  });
}

/** Construct a Histogram in the `sr_` namespace. Defaults to LATENCY_BUCKETS. */
export function histogram<L extends string = string>(opts: HistogramOpts<L>): Histogram<L> {
  return new Histogram<L>({
    name: `sr_${opts.name}`,
    help: opts.help,
    buckets: opts.buckets ? [...opts.buckets] : [...LATENCY_BUCKETS],
    registers: [registry],
    ...withLabelNames(opts.labelNames),
  });
}

/** Construct a Summary in the `sr_` namespace. Defaults to p50/p90/p95/p99/p999. */
export function summary<L extends string = string>(opts: SummaryOpts<L>): Summary<L> {
  return new Summary<L>({
    name: `sr_${opts.name}`,
    help: opts.help,
    percentiles: opts.percentiles ? [...opts.percentiles] : [0.5, 0.9, 0.95, 0.99, 0.999],
    registers: [registry],
    ...withLabelNames(opts.labelNames),
  });
}

/** Render Prometheus text-format for the /internal/metrics endpoint. */
export async function renderText(): Promise<string> {
  return registry.metrics();
}

/** Text content-type for /internal/metrics responses. */
export const contentType: string = registry.contentType;
