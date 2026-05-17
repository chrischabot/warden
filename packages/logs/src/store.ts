/**
 * Log store.
 *
 * Append-only with a capacity cap. When capacity is exceeded the
 * oldest entry is evicted (FIFO). Storage is a circular buffer so
 * both append and eviction are O(1); only iteration (during query)
 * is O(n). Production wiring (Ring 4) lands logs in the columnar
 * event store; this in-memory store is the metadata index the API
 * hits for recent logs and for the dev tail.
 */

import { LEVEL_RANK } from './types';
import type { LogEvent, LogListOptions, LogQuery } from './types';

export interface LogStoreOptions {
  /** Maximum number of records held in memory. Default 100_000. */
  readonly capacity?: number;
}

export class LogStore {
  private readonly capacity: number;
  private readonly buffer: Array<LogEvent | undefined>;
  /** Index of the next slot to write into. */
  private head = 0;
  /** Number of live entries in the buffer (≤ capacity). */
  private count = 0;
  /** Total number of events appended (including evicted). */
  private appended = 0;

  constructor(options: LogStoreOptions = {}) {
    const cap = options.capacity ?? 100_000;
    if (cap <= 0 || !Number.isInteger(cap)) {
      throw new RangeError(`LogStore: capacity must be a positive integer, got ${cap}`);
    }
    this.capacity = cap;
    this.buffer = new Array<LogEvent | undefined>(cap);
  }

  append(event: LogEvent): void {
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.appended += 1;
  }

  size(): number {
    return this.count;
  }

  totalAppended(): number {
    return this.appended;
  }

  /** Read events in insertion order, optional filter. */
  query(query: LogQuery = {}, options: LogListOptions = {}): {
    readonly logs: readonly LogEvent[];
    readonly total: number;
  } {
    const minRank = query.minLevel ? LEVEL_RANK[query.minLevel] : -1;
    const needle =
      query.searchSubstring !== undefined && query.searchSubstring.length > 0
        ? query.searchSubstring.toLowerCase()
        : undefined;
    const filtered: LogEvent[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const e = this.buffer[idx];
      if (e === undefined) continue;
      if (query.projectId !== undefined && e.projectId !== query.projectId) continue;
      if (minRank >= 0 && LEVEL_RANK[e.level] < minRank) continue;
      if (query.traceId !== undefined && e.traceId !== query.traceId) continue;
      if (query.sinceTimestamp !== undefined && e.timestamp < query.sinceTimestamp) {
        continue;
      }
      if (query.untilTimestamp !== undefined && e.timestamp > query.untilTimestamp) {
        continue;
      }
      if (query.environment !== undefined && e.environment !== query.environment) {
        continue;
      }
      if (query.release !== undefined && e.release !== query.release) {
        continue;
      }
      if (query.tagKey !== undefined) {
        if (!e.tags || e.tags[query.tagKey] !== query.tagValue) continue;
      }
      if (needle !== undefined && !e.message.toLowerCase().includes(needle)) continue;
      filtered.push(e);
    }
    const dir = options.sortDir ?? 'desc';
    const mult = dir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return (a.timestamp - b.timestamp) * mult;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    return Object.freeze({
      logs: Object.freeze(filtered.slice(offset, offset + limit)),
      total: filtered.length,
    });
  }

  /**
   * Snapshot of the live buffer in insertion order (oldest →
   * newest). `sinceIndex` is interpreted against the per-store
   * "live window" — i.e. 0 means the oldest currently-resident
   * entry, not the oldest ever appended.
   */
  snapshot(sinceIndex = 0): readonly LogEvent[] {
    const out: LogEvent[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    const from = Math.max(0, sinceIndex);
    for (let i = from; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const e = this.buffer[idx];
      if (e !== undefined) out.push(e);
    }
    return Object.freeze(out);
  }
}
