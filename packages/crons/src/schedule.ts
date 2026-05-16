// Crontab expression parser and tick generator.
//
// Accepts the standard 5-field form:
//
//   minute hour day-of-month month day-of-week
//
// with these tokens per field:
//   - `*`     match everything
//   - `n`     exact value
//   - `a-b`   range
//   - `*/n`   step from start of range
//   - `a-b/n` step within range
//   - `a,b`   union (commas, no spaces)
//
// Plus the @-descriptors `@yearly`, `@monthly`, `@weekly`, `@daily`,
// `@hourly`, and `@reboot` (treated as `@hourly` for monitor purposes —
// we have no boot concept).
//
// `nextTickAfter(expr, ms)` returns the smallest tick > `ms` (or `>=`
// if `inclusive`), computed in UTC. Timezone-aware evaluation is
// documented for follow-on; the spec §5.6 timezone field is accepted
// but ignored in this first cut.
//
// Day-of-week accepts 0..6 (0 = Sunday) and also the POSIX-style value
// 7 as Sunday, which is normalised to 0.

import type { Schedule, ScheduleCrontab, ScheduleInterval } from './types';

const DESCRIPTORS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@reboot': '0 * * * *',
};

interface ParsedCrontab {
  readonly minute: ReadonlySet<number>; // 0..59
  readonly hour: ReadonlySet<number>; // 0..23
  readonly dom: ReadonlySet<number>; // 1..31
  readonly month: ReadonlySet<number>; // 1..12
  readonly dow: ReadonlySet<number>; // 0..6 (0 = Sun); 7 normalised to 0.
  // True iff the source expression specified dom or dow restrictively.
  readonly domSpecified: boolean;
  readonly dowSpecified: boolean;
}

export class CrontabParseError extends Error {
  public readonly expression: string;
  constructor(message: string, expression: string) {
    super(message);
    this.name = 'CrontabParseError';
    this.expression = expression;
  }
}

const MINUTE_RANGE: [number, number] = [0, 59];
const HOUR_RANGE: [number, number] = [0, 23];
const DOM_RANGE: [number, number] = [1, 31];
const MONTH_RANGE: [number, number] = [1, 12];
const DOW_RANGE: [number, number] = [0, 7];

export function parseCrontab(expression: string): ParsedCrontab {
  const expanded = DESCRIPTORS[expression.trim().toLowerCase()] ?? expression;
  const fields = expanded.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CrontabParseError(
      `crontab must have 5 fields, got ${fields.length}: "${expression}"`,
      expression,
    );
  }
  const [m, h, dom, mo, dow] = fields as [string, string, string, string, string];
  // Day-of-week: accept POSIX value 7 as Sunday; normalise to 0.
  const dowSet = parseField(dow, DOW_RANGE, expression);
  if (dowSet.has(7)) {
    dowSet.delete(7);
    dowSet.add(0);
  }
  return Object.freeze({
    minute: parseField(m, MINUTE_RANGE, expression),
    hour: parseField(h, HOUR_RANGE, expression),
    dom: parseField(dom, DOM_RANGE, expression),
    month: parseField(mo, MONTH_RANGE, expression),
    dow: dowSet,
    domSpecified: dom !== '*',
    dowSpecified: dow !== '*',
  });
}

function parseField(field: string, [min, max]: [number, number], expression: string): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    addPart(out, part, min, max, expression);
  }
  return out;
}

function addPart(
  out: Set<number>,
  part: string,
  min: number,
  max: number,
  expression: string,
): void {
  let step = 1;
  let body = part;
  if (part.includes('/')) {
    const idx = part.indexOf('/');
    body = part.substring(0, idx);
    const stepStr = part.substring(idx + 1);
    step = Number.parseInt(stepStr, 10);
    if (!Number.isInteger(step) || step <= 0) {
      throw new CrontabParseError(`invalid step "${stepStr}" in "${part}"`, expression);
    }
  }
  let lo: number;
  let hi: number;
  if (body === '*') {
    lo = min;
    hi = max;
  } else if (body.includes('-')) {
    const [a, b] = body.split('-');
    lo = Number.parseInt(a as string, 10);
    hi = Number.parseInt(b as string, 10);
  } else {
    lo = Number.parseInt(body, 10);
    hi = lo;
  }
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
    throw new CrontabParseError(`invalid range "${body}" in "${part}"`, expression);
  }
  if (lo < min || hi > max || lo > hi) {
    throw new CrontabParseError(
      `range ${lo}-${hi} out of bounds [${min},${max}] in "${part}"`,
      expression,
    );
  }
  for (let v = lo; v <= hi; v += step) out.add(v);
}

// Compute the next tick at or after `fromMs`.
//
// If `inclusive=false` the result is strictly greater; otherwise it
// may equal `fromMs` when that instant is itself a tick.
//
// For schedules with both DOM and DOW specified, the OR rule applies
// (crontab's classic quirk): either match qualifies.
export function nextTickAfter(expression: string, fromMs: number, inclusive = false): number {
  const p = parseCrontab(expression);
  // Operate on a UTC Date one minute at a time. The brute-force
  // approach is bounded — within 366 days, every cron expression must
  // produce a tick (otherwise the expression is unsatisfiable and we
  // throw).
  let d = new Date(fromMs);
  // Align to next minute boundary.
  d.setUTCSeconds(0, 0);
  if (!inclusive || d.getTime() < fromMs) {
    d = new Date(d.getTime() + 60_000);
  }
  const horizon = d.getTime() + 366 * 24 * 60 * 60 * 1_000;
  while (d.getTime() <= horizon) {
    if (matches(p, d)) return d.getTime();
    d = new Date(d.getTime() + 60_000);
  }
  throw new CrontabParseError(`crontab is unsatisfiable: "${expression}"`, expression);
}

function matches(p: ParsedCrontab, d: Date): boolean {
  if (!p.minute.has(d.getUTCMinutes())) return false;
  if (!p.hour.has(d.getUTCHours())) return false;
  if (!p.month.has(d.getUTCMonth() + 1)) return false;
  const dom = d.getUTCDate();
  const dow = d.getUTCDay();
  const dayOk =
    p.domSpecified && p.dowSpecified
      ? p.dom.has(dom) || p.dow.has(dow)
      : p.dom.has(dom) && p.dow.has(dow);
  return dayOk;
}

// Compute next tick for any Schedule. Interval schedules tick at
// `anchorAt + n*intervalMs`.
export function nextScheduledTick(schedule: Schedule, fromMs: number, inclusive = false): number {
  if (schedule.type === 'crontab') {
    return nextTickAfter((schedule as ScheduleCrontab).expression, fromMs, inclusive);
  }
  const s = schedule as ScheduleInterval;
  if (!Number.isFinite(s.intervalMs) || s.intervalMs <= 0) {
    throw new RangeError(`nextScheduledTick: interval must be positive, got ${s.intervalMs}`);
  }
  const anchor = s.anchorAt ?? fromMs;
  if (fromMs <= anchor) return anchor;
  const delta = fromMs - anchor;
  let ticks = Math.floor(delta / s.intervalMs);
  let next = anchor + ticks * s.intervalMs;
  if (next < fromMs || (!inclusive && next === fromMs)) {
    ticks += 1;
    next = anchor + ticks * s.intervalMs;
  }
  return next;
}
