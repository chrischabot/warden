import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ShardConnection } from '../src/connection';
import { MigrationRunner } from '../src/migration';
import type { Migration } from '../src/types';

let conn: ShardConnection;

beforeEach(() => {
  conn = new ShardConnection(':memory:');
  conn.open();
});
afterEach(() => conn.close());

describe('MigrationRunner — construction', () => {
  test('rejects non-monotone versions', () => {
    expect(
      () =>
        new MigrationRunner([
          { version: 1, description: 'a', sql: 'CREATE TABLE a (id INTEGER)' },
          { version: 1, description: 'b', sql: 'CREATE TABLE b (id INTEGER)' },
        ]),
    ).toThrow(RangeError);
    expect(
      () =>
        new MigrationRunner([
          { version: 2, description: 'a', sql: '' },
          { version: 1, description: 'b', sql: '' },
        ]),
    ).toThrow(RangeError);
  });

  test('rejects non-integer versions', () => {
    expect(() => new MigrationRunner([{ version: 1.5, description: 'a', sql: '' }])).toThrow(
      RangeError,
    );
  });
});

describe('MigrationRunner — apply', () => {
  const migrations: Migration[] = [
    {
      version: 1,
      description: 'create projects',
      sql: 'CREATE TABLE projects (id INTEGER PRIMARY KEY, slug TEXT NOT NULL)',
    },
    {
      version: 2,
      description: 'add platform column',
      sql: 'ALTER TABLE projects ADD COLUMN platform TEXT',
    },
    {
      version: 3,
      description: 'create groups + index',
      sql:
        'CREATE TABLE groups (id TEXT PRIMARY KEY, project_id INTEGER NOT NULL); ' +
        'CREATE INDEX groups_by_project ON groups(project_id)',
    },
  ];

  test('applies every migration in order', () => {
    const runner = new MigrationRunner(migrations);
    const applied = runner.apply(conn);
    expect(applied).toEqual([1, 2, 3]);
    // Table exists and has the platform column.
    conn.run('INSERT INTO projects (id, slug, platform) VALUES (?, ?, ?)', [1, 'web', 'js']);
    expect(conn.first<{ slug: string }>('SELECT slug FROM projects WHERE id = 1')?.slug).toBe(
      'web',
    );
    expect(
      conn.first<{ count: number }>(
        'SELECT count(*) AS count FROM sqlite_master WHERE type = ? AND name = ?',
        ['index', 'groups_by_project'],
      )?.count,
    ).toBe(1);
  });

  test('second apply is a no-op', () => {
    const runner = new MigrationRunner(migrations);
    runner.apply(conn);
    expect(runner.apply(conn)).toEqual([]);
  });

  test('applying a partial migration set then re-applying after extending it', () => {
    const runnerA = new MigrationRunner(migrations.slice(0, 2));
    expect(runnerA.apply(conn)).toEqual([1, 2]);
    const runnerB = new MigrationRunner(migrations);
    expect(runnerB.apply(conn)).toEqual([3]);
  });

  test('migrations table records description + applied_at', () => {
    new MigrationRunner(migrations.slice(0, 1)).apply(conn);
    const row = conn.first<{ description: string; applied_at: number }>(
      'SELECT description, applied_at FROM _sr_migrations WHERE version = ?',
      [1],
    );
    expect(row?.description).toBe('create projects');
    expect(row?.applied_at).toBeGreaterThan(0);
  });

  test('failing migration rolls back the transaction', () => {
    const runner = new MigrationRunner([
      {
        version: 1,
        description: 'ok',
        sql: 'CREATE TABLE projects (id INTEGER PRIMARY KEY)',
      },
      {
        version: 2,
        description: 'broken',
        sql: 'CREATE TABLE other (id INTEGER); INSERT INTO does_not_exist VALUES (1)',
      },
    ]);
    expect(() => runner.apply(conn)).toThrow();
    // First migration applied; second migration's `other` table must NOT exist (rolled back).
    expect(
      conn.first<{ count: number }>(
        'SELECT count(*) AS count FROM sqlite_master WHERE type = ? AND name = ?',
        ['table', 'other'],
      )?.count,
    ).toBe(0);
    // Migrations table records only version 1.
    expect(
      conn.all<{ version: number }>('SELECT version FROM _sr_migrations').map((r) => r.version),
    ).toEqual([1]);
  });

  test('detects out-of-order pending versions vs already-applied', () => {
    // First apply 1, 2.
    new MigrationRunner([
      { version: 1, description: '1', sql: 'CREATE TABLE a (id INTEGER)' },
      { version: 2, description: '2', sql: 'CREATE TABLE b (id INTEGER)' },
    ]).apply(conn);
    // Then try to introduce a version 1.5 in a new runner — version
    // is technically less than max applied = 2, so it must reject.
    const bad = new MigrationRunner([
      { version: 1, description: '1', sql: '' }, // already applied; OK to skip
      { version: 2, description: '2', sql: '' },
      // simulate someone slipping in a lower-than-max version after the fact
      // by adding it last → the runner sees it as pending but its
      // version (1) is < maxApplied (2), so it must throw.
    ]);
    // The construction above is monotone (1, 2) so it doesn't throw at the
    // constructor. Force the out-of-order case differently:
    const reverseRunner = (): MigrationRunner =>
      new MigrationRunner([{ version: 0, description: '0', sql: 'CREATE TABLE c (id INTEGER)' }]);
    expect(() => reverseRunner().apply(conn)).toThrow();
    // `bad` is fine to apply because every version is already applied.
    expect(bad.apply(conn)).toEqual([]);
  });
});

describe('MigrationRunner — status', () => {
  test('reports applied + pending', () => {
    const runner = new MigrationRunner([
      { version: 1, description: 'a', sql: 'CREATE TABLE a (id INTEGER)' },
      { version: 2, description: 'b', sql: 'CREATE TABLE b (id INTEGER)' },
      { version: 3, description: 'c', sql: 'CREATE TABLE c (id INTEGER)' },
    ]);
    // Apply only the first.
    new MigrationRunner([
      { version: 1, description: 'a', sql: 'CREATE TABLE a (id INTEGER)' },
    ]).apply(conn);
    const status = runner.status(conn, 0);
    expect(status.applied).toEqual([1]);
    expect(status.pending).toEqual([2, 3]);
  });
});
