import { describe, expect, test } from 'bun:test';
import { HealthCheckRegistry } from '../src/health';
import type { HealthReport } from '../src/types';

describe('HealthCheckRegistry — register + run', () => {
  test('aggregate is pass when every check passes', async () => {
    const r = new HealthCheckRegistry();
    r.register('columnar', 'shard-0', () => ({ status: 'pass' }));
    r.register('columnar', 'shard-1', () => ({ status: 'pass' }));
    const out = await r.run();
    expect(out.status).toBe('pass');
    expect(out.results.length).toBe(2);
  });

  test('aggregate is warn when any check is warn (and none fail)', async () => {
    const r = new HealthCheckRegistry();
    r.register('queue', 'segment-roll', () => ({ status: 'pass' }));
    r.register('queue', 'fsync-lag', () => ({ status: 'warn', message: 'lag 12ms' }));
    const out = await r.run();
    expect(out.status).toBe('warn');
  });

  test('aggregate is fail when any check fails', async () => {
    const r = new HealthCheckRegistry();
    r.register('a', '1', () => ({ status: 'warn' }));
    r.register('b', '1', () => ({ status: 'fail' }));
    r.register('c', '1', () => ({ status: 'pass' }));
    expect((await r.run()).status).toBe('fail');
  });

  test('async checks run concurrently and complete', async () => {
    const r = new HealthCheckRegistry();
    let count = 0;
    const slowReport: HealthReport = { status: 'pass', message: 'slow' };
    r.register('s', 'a', async () => {
      count++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return slowReport;
    });
    r.register('s', 'b', async () => {
      count++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return slowReport;
    });
    const out = await r.run();
    expect(count).toBe(2);
    expect(out.status).toBe('pass');
  });

  test('check that throws is reported as fail', async () => {
    const r = new HealthCheckRegistry();
    r.register('x', 'boom', () => {
      throw new Error('disk full');
    });
    const out = await r.run();
    expect(out.status).toBe('fail');
    expect(out.results[0]?.status).toBe('fail');
    expect(out.results[0]?.message).toContain('disk full');
  });

  test('check that times out is reported as fail', async () => {
    const r = new HealthCheckRegistry({ checkTimeoutMs: 10 });
    r.register(
      'x',
      'slow',
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const out = await r.run();
    expect(out.status).toBe('fail');
    expect(out.results[0]?.message).toContain('timed out');
  });

  test('duplicate registration rejects', () => {
    const r = new HealthCheckRegistry();
    r.register('x', '1', () => ({ status: 'pass' }));
    expect(() => r.register('x', '1', () => ({ status: 'pass' }))).toThrow(RangeError);
  });

  test('unregister removes the check', async () => {
    const r = new HealthCheckRegistry();
    r.register('x', '1', () => ({ status: 'fail' }));
    r.unregister('x', '1');
    const out = await r.run();
    expect(out.status).toBe('pass');
    expect(out.results.length).toBe(0);
  });

  test('list returns registered checks', () => {
    const r = new HealthCheckRegistry();
    r.register('a', '1', () => ({ status: 'pass' }));
    r.register('a', '2', () => ({ status: 'pass' }));
    expect(r.list().length).toBe(2);
  });

  test('empty registry is pass', async () => {
    const out = await new HealthCheckRegistry().run();
    expect(out.status).toBe('pass');
    expect(out.results.length).toBe(0);
  });
});
