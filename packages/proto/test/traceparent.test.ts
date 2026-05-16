import { describe, expect, test } from 'bun:test';
import { formatTraceparent, parseTraceparent, TraceparentParseError } from '../src/traceparent';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';

describe('parseTraceparent', () => {
  test('canonical sampled=1', () => {
    const tp = parseTraceparent(`00-${TRACE}-${PARENT}-01`);
    expect(tp.version).toBe(0);
    expect(tp.traceId).toBe(TRACE);
    expect(tp.parentId).toBe(PARENT);
    expect(tp.flags).toBe(1);
    expect(tp.sampled).toBe(true);
  });

  test('canonical sampled=0', () => {
    const tp = parseTraceparent(`00-${TRACE}-${PARENT}-00`);
    expect(tp.sampled).toBe(false);
  });

  test('higher flag bits do not affect sampled', () => {
    const tp = parseTraceparent(`00-${TRACE}-${PARENT}-fe`);
    expect(tp.flags).toBe(0xfe);
    expect(tp.sampled).toBe(false);
  });

  test('uppercase normalised to lowercase', () => {
    const tp = parseTraceparent(`00-${TRACE.toUpperCase()}-${PARENT.toUpperCase()}-01`);
    expect(tp.traceId).toBe(TRACE);
    expect(tp.parentId).toBe(PARENT);
  });
});

describe('parseTraceparent — invalid', () => {
  test('empty', () => {
    expect(() => parseTraceparent('')).toThrow(TraceparentParseError);
  });

  test('reserved version ff', () => {
    expect(() => parseTraceparent(`ff-${TRACE}-${PARENT}-01`)).toThrow(/reserved/);
  });

  test('all-zero trace_id', () => {
    expect(() => parseTraceparent(`00-${'0'.repeat(32)}-${PARENT}-01`)).toThrow(/trace_id/);
  });

  test('all-zero parent_id', () => {
    expect(() => parseTraceparent(`00-${TRACE}-${'0'.repeat(16)}-01`)).toThrow(/parent_id/);
  });

  test('non-hex flags', () => {
    expect(() => parseTraceparent(`00-${TRACE}-${PARENT}-zz`)).toThrow(/flags/);
  });

  test('wrong number of fields', () => {
    expect(() => parseTraceparent(`00-${TRACE}-${PARENT}`)).toThrow();
    expect(() => parseTraceparent(`00-${TRACE}-${PARENT}-01-extra`)).toThrow();
  });
});

describe('formatTraceparent', () => {
  test('emits canonical lowercase 4-field form', () => {
    expect(
      formatTraceparent({
        version: 0,
        traceId: TRACE,
        parentId: PARENT,
        flags: 1,
        sampled: true,
      }),
    ).toBe(`00-${TRACE}-${PARENT}-01`);
  });

  test('round trip', () => {
    const original = {
      version: 0,
      traceId: TRACE,
      parentId: PARENT,
      flags: 1,
      sampled: true,
    } as const;
    expect(parseTraceparent(formatTraceparent(original))).toEqual(original);
  });
});
