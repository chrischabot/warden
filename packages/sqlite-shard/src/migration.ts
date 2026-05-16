/**
 * Migration runner.
 *
 * Maintains a per-shard `_sr_migrations` table:
 *
 *   CREATE TABLE _sr_migrations (
 *     version     INTEGER PRIMARY KEY,
 *     description TEXT NOT NULL,
 *     applied_at  INTEGER NOT NULL
 *   );
 *
 * Each `Migration` is applied inside a single transaction. The
 * runner refuses to apply a migration whose version is less than
 * the maximum applied version (versions must be monotone).
 *
 * Multiple SQL statements within `migration.sql` are split on `;`
 * — comments and empty statements are tolerated.
 */

import type { ShardConnection } from './connection';
import type { Migration, MigrationStatus } from './types';

export class MigrationRunner {
  constructor(public readonly migrations: readonly Migration[]) {
    // Versions must be strictly increasing.
    let prev = -1;
    for (const m of migrations) {
      if (!Number.isInteger(m.version) || m.version <= prev) {
        throw new RangeError(
          `MigrationRunner: versions must be monotone integers, got ${m.version} after ${prev}`,
        );
      }
      prev = m.version;
    }
  }

  /** Apply every pending migration to `conn`. Returns versions actually applied. */
  apply(conn: ShardConnection): readonly number[] {
    ensureMigrationTable(conn);
    const applied = appliedVersions(conn);
    const appliedSet = new Set(applied);
    const out: number[] = [];
    for (const m of this.migrations) {
      if (appliedSet.has(m.version)) continue;
      if (out.length === 0 && applied.length > 0) {
        // Sanity: pending versions must all be > max applied.
        const maxApplied = Math.max(...applied);
        if (m.version <= maxApplied) {
          throw new Error(
            `MigrationRunner: migration ${m.version} is not greater than max applied ${maxApplied}; out-of-order migrations are not supported`,
          );
        }
      }
      this.applyOne(conn, m);
      out.push(m.version);
    }
    return out;
  }

  /** Compute applied + pending versions without mutating state. */
  status(conn: ShardConnection, shardIndex: number): MigrationStatus {
    ensureMigrationTable(conn);
    const applied = appliedVersions(conn);
    const appliedSet = new Set(applied);
    const pending: number[] = [];
    for (const m of this.migrations) {
      if (!appliedSet.has(m.version)) pending.push(m.version);
    }
    return Object.freeze({
      shardIndex,
      applied: Object.freeze([...applied].sort((a, b) => a - b)),
      pending: Object.freeze(pending),
    });
  }

  private applyOne(conn: ShardConnection, migration: Migration): void {
    conn.transaction((c) => {
      for (const statement of splitSqlStatements(migration.sql)) {
        c.exec(statement);
      }
      c.run('INSERT INTO _sr_migrations (version, description, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.description,
        Date.now(),
      ]);
    });
  }
}

function ensureMigrationTable(conn: ShardConnection): void {
  conn.exec(
    'CREATE TABLE IF NOT EXISTS _sr_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
}

function appliedVersions(conn: ShardConnection): readonly number[] {
  const rows = conn.all<{ version: number }>('SELECT version FROM _sr_migrations ORDER BY version');
  return rows.map((r) => r.version);
}

function splitSqlStatements(sql: string): string[] {
  // Naïve splitter — sufficient for our migrations, which don't
  // contain string literals with semicolons. Production-grade
  // migration tools use a proper SQL tokenizer.
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
}
