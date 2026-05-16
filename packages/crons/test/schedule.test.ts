import { describe, expect, test } from 'bun:test';
import { CrontabParseError, nextScheduledTick, nextTickAfter, parseCrontab } from '../src/schedule';

function utc(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h, mi, 0, 0);
}

describe('parseCrontab — happy paths', () => {
  test('all-stars', () => {
    const p = parseCrontab('* * * * *');
    expect(p.minute.size).toBe(60);
    expect(p.hour.size).toBe(24);
    expect(p.dom.size).toBe(31);
    expect(p.month.size).toBe(12);
    expect(p.dow.size).toBe(7);
  });

  test('exact minute / hour', () => {
    const p = parseCrontab('0 12 * * *');
    expect([...p.minute]).toEqual([0]);
    expect([...p.hour]).toEqual([12]);
  });

  test('range and step', () => {
    const p = parseCrontab('*/15 9-17 * * 1-5');
    expect([...p.minute]).toEqual([0, 15, 30, 45]);
    expect([...p.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...p.dow]).toEqual([1, 2, 3, 4, 5]);
  });

  test('union (commas)', () => {
    const p = parseCrontab('0,30 * * * *');
    expect([...p.minute]).toEqual([0, 30]);
  });

  test('descriptors expand', () => {
    expect(parseCrontab('@hourly').minute.size).toBe(1);
    expect(parseCrontab('@daily').hour.size).toBe(1);
    expect([...parseCrontab('@weekly').dow]).toEqual([0]);
    expect([...parseCrontab('@monthly').dom]).toEqual([1]);
  });
  test('dow=7 is normalised to Sunday (POSIX-style)', () => {
    const p = parseCrontab('0 0 * * 7');
    expect([...p.dow]).toEqual([0]);
  });

  test('union dow=0,7 collapses to Sunday only', () => {
    const p = parseCrontab('0 0 * * 0,7');
    expect([...p.dow]).toEqual([0]);
  });
});

describe('parseCrontab — errors', () => {
  test('wrong field count', () => {
    expect(() => parseCrontab('* * *')).toThrow(CrontabParseError);
    expect(() => parseCrontab('* * * * * *')).toThrow(CrontabParseError);
  });

  test('out-of-range value', () => {
    expect(() => parseCrontab('60 * * * *')).toThrow(CrontabParseError);
    expect(() => parseCrontab('* 24 * * *')).toThrow(CrontabParseError);
  });

  test('reverse range', () => {
    expect(() => parseCrontab('30-15 * * * *')).toThrow(CrontabParseError);
  });

  test('zero step', () => {
    expect(() => parseCrontab('*/0 * * * *')).toThrow(CrontabParseError);
  });
});

describe('nextTickAfter', () => {
  test('every minute', () => {
    const t0 = utc(2026, 5, 16, 12, 0);
    const t1 = nextTickAfter('* * * * *', t0);
    expect(t1).toBe(t0 + 60_000);
  });

  test('top of each hour', () => {
    const t0 = utc(2026, 5, 16, 12, 30);
    const t1 = nextTickAfter('0 * * * *', t0);
    expect(t1).toBe(utc(2026, 5, 16, 13, 0));
  });

  test('5am UTC daily', () => {
    const t0 = utc(2026, 5, 16, 12, 0);
    const t1 = nextTickAfter('0 5 * * *', t0);
    expect(t1).toBe(utc(2026, 5, 17, 5, 0));
  });

  test('monthly on the 15th', () => {
    const t0 = utc(2026, 5, 1, 0, 0);
    const t1 = nextTickAfter('0 0 15 * *', t0);
    expect(t1).toBe(utc(2026, 5, 15, 0, 0));
  });

  test('crontab OR rule (dom + dow both specified)', () => {
    // Either dom=1 OR dow=Friday matches. From 2026-05-16 (Saturday),
    // the next match is the following Friday (May 22).
    const t0 = utc(2026, 5, 16, 12, 0);
    const t1 = nextTickAfter('0 0 1 * 5', t0);
    // Friday May 22 2026 at 00:00
    expect(t1).toBe(utc(2026, 5, 22, 0, 0));
  });

  test('inclusive=true returns current minute if it matches', () => {
    const t0 = utc(2026, 5, 16, 12, 0);
    const t1 = nextTickAfter('0 12 * * *', t0, true);
    expect(t1).toBe(t0);
  });

  test('unsatisfiable expressions throw', () => {
    expect(() => nextTickAfter('* * 31 2 *', utc(2026, 1, 1, 0, 0))).toThrow(CrontabParseError);
  });
});

describe('nextScheduledTick — interval', () => {
  test('first tick is the anchor itself', () => {
    const t = nextScheduledTick(
      { type: 'interval', intervalMs: 60_000, anchorAt: 1_000_000 },
      500_000,
    );
    expect(t).toBe(1_000_000);
  });

  test('aligns to anchor + N * interval', () => {
    const sched = { type: 'interval' as const, intervalMs: 60_000, anchorAt: 0 };
    expect(nextScheduledTick(sched, 30_000)).toBe(60_000);
    expect(nextScheduledTick(sched, 60_000)).toBe(120_000);
    expect(nextScheduledTick(sched, 61_000)).toBe(120_000);
    expect(nextScheduledTick(sched, 60_000, true)).toBe(60_000);
  });

  test('rejects non-positive interval', () => {
    expect(() => nextScheduledTick({ type: 'interval', intervalMs: 0, anchorAt: 0 }, 0)).toThrow(
      RangeError,
    );
  });
});
