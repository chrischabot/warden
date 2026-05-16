/**
 * Per-shard bun:sqlite connection.
 *
 * Holds one Database handle, a prepared-statement cache, and
 * lifecycle helpers. Configures sane defaults for write workloads
 * (WAL journal, NORMAL synchronous, foreign-keys ON).
 *
 * Caller manages the connection lifetime via open/close. Statements
 * cached during the connection's lifetime are auto-finalised when
 * the connection closes.
 */

import { Database, type Statement } from 'bun:sqlite';

export interface ConnectionOptions {
  /** Open in read-only mode. Default false. */
  readonly readonly?: boolean;
  /** Disable WAL + the other write tunings. Useful for read replicas. */
  readonly skipPragmas?: boolean;
  /** Max prepared statements cached. Default 256. */
  readonly maxCachedStatements?: number;
}

export class ShardConnection {
  private db: Database | undefined;
  private readonly cache = new Map<string, Statement>();
  private readonly maxCached: number;
  private closed = false;

  constructor(
    public readonly path: string,
    public readonly options: ConnectionOptions = {},
  ) {
    this.maxCached = options.maxCachedStatements ?? 256;
  }

  open(): void {
    if (this.db) return;
    if (this.closed) {
      throw new Error('ShardConnection: cannot reopen a closed connection');
    }
    this.db = new Database(this.path, this.options.readonly ? { readonly: true } : undefined);
    if (!this.options.skipPragmas) {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
      this.db.exec('PRAGMA temp_store = MEMORY;');
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const s of this.cache.values()) {
      try {
        s.finalize();
      } catch {
        /* ignore */
      }
    }
    this.cache.clear();
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }

  /**
   * Run a non-query statement (CREATE/INSERT/UPDATE/DELETE).
   * Returns `{ changes, lastInsertRowid }`.
   */
  run(
    sql: string,
    params: readonly unknown[] = [],
  ): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.prepare(sql);
    return stmt.run(...params);
  }

  /** Run multiple statements (e.g. schema migrations). */
  exec(sql: string): void {
    this.requireDb().exec(sql);
  }

  /** Fetch the first row or undefined. */
  first<T>(sql: string, params: readonly unknown[] = []): T | undefined {
    const stmt = this.prepare(sql);
    const row = stmt.get(...params);
    return row === null || row === undefined ? undefined : (row as T);
  }

  /** Fetch every matching row. */
  all<T>(sql: string, params: readonly unknown[] = []): T[] {
    const stmt = this.prepare(sql);
    return stmt.all(...params) as T[];
  }

  /** Stream rows lazily. */
  *iterate<T>(sql: string, params: readonly unknown[] = []): IterableIterator<T> {
    const stmt = this.prepare(sql);
    yield* stmt.iterate(...params) as IterableIterator<T>;
  }

  /**
   * Run `fn` inside a transaction. Rolls back on throw, commits on
   * success. The wrapped function receives this connection for
   * convenience.
   */
  transaction<T>(fn: (conn: ShardConnection) => T): T {
    const db = this.requireDb();
    const wrapped = db.transaction((c: ShardConnection): T => fn(c));
    return wrapped(this);
  }

  /** Underlying handle. Exposed for advanced callers (avoid where possible). */
  get database(): Database {
    return this.requireDb();
  }

  private prepare(sql: string): Statement {
    const cached = this.cache.get(sql);
    if (cached) return cached;
    if (this.cache.size >= this.maxCached) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const old = this.cache.get(oldestKey);
        if (old) {
          try {
            old.finalize();
          } catch {
            /* ignore */
          }
        }
        this.cache.delete(oldestKey);
      }
    }
    const stmt = this.requireDb().prepare(sql);
    this.cache.set(sql, stmt);
    return stmt;
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error(`ShardConnection(${this.path}): connection is not open. Call open() first.`);
    }
    return this.db;
  }
}
