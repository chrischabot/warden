/**
 * In-memory transaction + span store.
 *
 * Same shape as @sr/issues/IssueStore: collect, index, query.
 * Production wiring: transactions land in the columnar event store
 * (Ring 1); this in-memory store is the metadata index that the
 * web UI / API hits for sub-trace navigation.
 */

import type {
  SortDir,
  Span,
  Transaction,
  TransactionListOptions,
  TransactionListResult,
  TransactionQuery,
  TransactionSortField,
} from './types';

export class TransactionStore {
  private readonly byEventId = new Map<string, Transaction>();
  private readonly byTraceId = new Map<string, Set<string>>();
  private readonly byProject = new Map<string, Set<string>>();
  private readonly spansByTrace = new Map<string, Span[]>();

  /** Record a transaction. Replaces any existing entry with the same event_id. */
  record(tx: Transaction): void {
    const existing = this.byEventId.get(tx.eventId);
    if (existing) {
      removeFromSet(this.byTraceId, existing.traceId, existing.eventId);
      removeFromSet(this.byProject, existing.projectId, existing.eventId);
      if (existing.spans && existing.spans.length > 0) {
        const arr = this.spansByTrace.get(existing.traceId);
        if (arr) {
          const stale = new Set(existing.spans.map((s) => s.spanId));
          const kept = arr.filter((s) => !stale.has(s.spanId));
          if (kept.length === 0) {
            this.spansByTrace.delete(existing.traceId);
          } else {
            this.spansByTrace.set(existing.traceId, kept);
          }
        }
      }
    }
    this.byEventId.set(tx.eventId, tx);
    addToSet(this.byTraceId, tx.traceId, tx.eventId);
    addToSet(this.byProject, tx.projectId, tx.eventId);
    if (tx.spans && tx.spans.length > 0) {
      const arr = this.spansByTrace.get(tx.traceId) ?? [];
      for (const s of tx.spans) arr.push(s);
      this.spansByTrace.set(tx.traceId, arr);
    }
  }

  /** Record one or more standalone spans for an existing trace. */
  recordSpans(traceId: string, spans: readonly Span[]): void {
    if (spans.length === 0) return;
    const arr = this.spansByTrace.get(traceId) ?? [];
    for (const s of spans) arr.push(s);
    this.spansByTrace.set(traceId, arr);
  }

  get(eventId: string): Transaction | undefined {
    return this.byEventId.get(eventId);
  }

  spansForTrace(traceId: string): readonly Span[] {
    return this.spansByTrace.get(traceId) ?? [];
  }

  transactionsForTrace(traceId: string): readonly Transaction[] {
    const ids = this.byTraceId.get(traceId);
    if (!ids) return [];
    const out: Transaction[] = [];
    for (const id of ids) {
      const tx = this.byEventId.get(id);
      if (tx) out.push(tx);
    }
    return out;
  }

  list(query: TransactionQuery = {}, options: TransactionListOptions = {}): TransactionListResult {
    const filtered: Transaction[] = [];
    for (const tx of this.byEventId.values()) {
      if (matches(tx, query)) filtered.push(tx);
    }
    sortTransactions(filtered, options.sortBy ?? 'timestamp', options.sortDir ?? 'desc');
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    return Object.freeze({
      transactions: Object.freeze(filtered.slice(offset, offset + limit)),
      total: filtered.length,
    });
  }

  /** Iterate every transaction. Order is insertion. */
  *all(): IterableIterator<Transaction> {
    yield* this.byEventId.values();
  }
}

function addToSet(m: Map<string, Set<string>>, key: string, value: string): void {
  const s = m.get(key) ?? new Set<string>();
  s.add(value);
  m.set(key, s);
}

function removeFromSet(m: Map<string, Set<string>>, key: string, value: string): void {
  const s = m.get(key);
  if (!s) return;
  s.delete(value);
  if (s.size === 0) m.delete(key);
}

function matches(tx: Transaction, q: TransactionQuery): boolean {
  if (q.projectId !== undefined && tx.projectId !== q.projectId) return false;
  if (q.transactionName !== undefined && tx.transaction !== q.transactionName) return false;
  if (q.op !== undefined && tx.op !== q.op) return false;
  if (q.environment !== undefined && tx.environment !== q.environment) return false;
  if (q.release !== undefined && tx.release !== q.release) return false;
  if (q.status && !q.status.includes(tx.status)) return false;
  if (q.traceId !== undefined && tx.traceId !== q.traceId) return false;
  if (q.sinceTimestamp !== undefined && tx.startTimestamp < q.sinceTimestamp) return false;
  if (q.untilTimestamp !== undefined && tx.startTimestamp > q.untilTimestamp) return false;
  if (q.minDurationMs !== undefined && tx.durationMs < q.minDurationMs) return false;
  if (q.maxDurationMs !== undefined && tx.durationMs > q.maxDurationMs) return false;
  return true;
}

function sortTransactions(arr: Transaction[], by: TransactionSortField, dir: SortDir): void {
  const mult = dir === 'asc' ? 1 : -1;
  arr.sort((a, b) => {
    const av = by === 'duration' ? a.durationMs : a.startTimestamp;
    const bv = by === 'duration' ? b.durationMs : b.startTimestamp;
    if (av !== bv) return (av - bv) * mult;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
}
