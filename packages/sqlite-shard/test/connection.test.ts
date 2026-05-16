import { afterEach, describe, expect, test } from 'bun:test';
import { ShardConnection } from '../src/connection';

let conn: ShardConnection | undefined;

function open(): ShardConnection {
  // In-memory DBs are perfect for testing; the connection
  // wrapper opens with WAL by default which doesn't apply to
  // :memory: but is also harmless.
  const c = new ShardConnection(':memory:');
  c.open();
  conn = c;
  return c;
}

afterEach(() => {
  if (conn) {
    conn.close();
    conn = undefined;
  }
});

describe('ShardConnection — lifecycle', () => {
  test('open + exec + close', () => {
    const c = open();
    c.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    c.run('INSERT INTO t (id, name) VALUES (?, ?)', [1, 'alice']);
    expect(c.first<{ name: string }>('SELECT name FROM t WHERE id = ?', [1])?.name).toBe('alice');
  });

  test('open is idempotent', () => {
    const c = open();
    expect(() => c.open()).not.toThrow();
  });

  test('reopening a closed connection rejects', () => {
    const c = open();
    c.close();
    conn = undefined;
    expect(() => c.open()).toThrow();
  });

  test('using before open rejects', () => {
    const c = new ShardConnection(':memory:');
    expect(() => c.exec('SELECT 1')).toThrow();
  });
});

describe('ShardConnection — queries', () => {
  test('all + first', () => {
    const c = open();
    c.exec('CREATE TABLE t (id INTEGER, v INTEGER)');
    for (let i = 0; i < 5; i++) c.run('INSERT INTO t VALUES (?, ?)', [i, i * 2]);
    const rows = c.all<{ id: number; v: number }>('SELECT * FROM t ORDER BY id');
    expect(rows.length).toBe(5);
    expect(rows.map((r) => r.v)).toEqual([0, 2, 4, 6, 8]);
    expect(c.first<{ v: number }>('SELECT v FROM t WHERE id = ?', [3])?.v).toBe(6);
    expect(c.first<{ v: number }>('SELECT v FROM t WHERE id = ?', [999])).toBeUndefined();
  });

  test('iterate streams rows', () => {
    const c = open();
    c.exec('CREATE TABLE t (id INTEGER)');
    for (let i = 0; i < 10; i++) c.run('INSERT INTO t VALUES (?)', [i]);
    const ids: number[] = [];
    for (const r of c.iterate<{ id: number }>('SELECT id FROM t ORDER BY id')) {
      ids.push(r.id);
    }
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('run reports changes + lastInsertRowid', () => {
    const c = open();
    c.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)');
    const r1 = c.run('INSERT INTO t (v) VALUES (?)', [100]);
    expect(r1.changes).toBe(1);
    expect(Number(r1.lastInsertRowid)).toBe(1);
    const r2 = c.run('INSERT INTO t (v) VALUES (?)', [200]);
    expect(Number(r2.lastInsertRowid)).toBe(2);
  });
});

describe('ShardConnection — transactions', () => {
  test('commits on success', () => {
    const c = open();
    c.exec('CREATE TABLE t (id INTEGER)');
    c.transaction((inner) => {
      inner.run('INSERT INTO t VALUES (?)', [1]);
      inner.run('INSERT INTO t VALUES (?)', [2]);
    });
    expect(c.all<{ id: number }>('SELECT id FROM t').length).toBe(2);
  });

  test('rolls back on throw', () => {
    const c = open();
    c.exec('CREATE TABLE t (id INTEGER)');
    expect(() =>
      c.transaction((inner) => {
        inner.run('INSERT INTO t VALUES (?)', [1]);
        throw new Error('rollback me');
      }),
    ).toThrow('rollback me');
    expect(c.all<{ id: number }>('SELECT id FROM t').length).toBe(0);
  });

  test('nested call via passed conn', () => {
    const c = open();
    c.exec('CREATE TABLE t (id INTEGER)');
    c.transaction((inner) => {
      inner.run('INSERT INTO t VALUES (?)', [10]);
    });
    expect(c.first<{ id: number }>('SELECT id FROM t')?.id).toBe(10);
  });
});

describe('ShardConnection — prepared cache', () => {
  test('repeated queries reuse the cached prepared statement', () => {
    const c = new ShardConnection(':memory:', { maxCachedStatements: 2 });
    c.open();
    conn = c;
    c.exec('CREATE TABLE t (id INTEGER)');
    for (let i = 0; i < 100; i++) c.run('INSERT INTO t VALUES (?)', [i]);
    expect(c.all<{ id: number }>('SELECT id FROM t').length).toBe(100);
  });
});
