import { describe, expect, test } from 'bun:test';
import { formatBaggage, parseBaggage } from '../src/baggage';

describe('parseBaggage', () => {
  test('empty input returns empty maps', () => {
    const b = parseBaggage('');
    expect(b.sentry).toEqual({});
    expect(b.thirdParty).toEqual([]);
  });

  test('sentry keys are split from third-party', () => {
    const b = parseBaggage('sentry-trace_id=abc,sentry-release=v1.0.0,vendor-foo=bar');
    expect(b.sentry).toEqual({ trace_id: 'abc', release: 'v1.0.0' });
    expect(b.thirdParty).toEqual([['vendor-foo', 'bar']]);
  });

  test('property syntax is stripped', () => {
    const b = parseBaggage('sentry-trace_id=abc;custom=ignored,vendor=v');
    expect(b.sentry).toEqual({ trace_id: 'abc' });
    expect(b.thirdParty).toEqual([['vendor', 'v']]);
  });

  test('percent-encoded values are decoded', () => {
    const b = parseBaggage('sentry-transaction=GET%20%2Fhello%20world');
    expect(b.sentry['transaction']).toBe('GET /hello world');
  });

  test('whitespace around entries is tolerated', () => {
    const b = parseBaggage('  sentry-a=1 ,   vendor-b=2  ');
    expect(b.sentry['a']).toBe('1');
    expect(b.thirdParty).toEqual([['vendor-b', '2']]);
  });

  test('malformed entries are dropped', () => {
    const b = parseBaggage('no-equals,=value-only,sentry-good=v');
    expect(b.sentry).toEqual({ good: 'v' });
    expect(b.thirdParty).toEqual([]);
  });

  test('insertion order of third-party preserved', () => {
    const b = parseBaggage('a=1,b=2,c=3');
    expect(b.thirdParty.map(([k]) => k)).toEqual(['a', 'b', 'c']);
  });
});

describe('formatBaggage', () => {
  test('round trips sentry + third-party', () => {
    const b = parseBaggage('sentry-trace_id=abc,vendor-foo=bar');
    const formatted = formatBaggage(b);
    const reparsed = parseBaggage(formatted);
    expect(reparsed.sentry).toEqual(b.sentry);
    expect(reparsed.thirdParty).toEqual(b.thirdParty);
  });

  test('encodes special characters', () => {
    const formatted = formatBaggage({
      sentry: { transaction: 'GET /hello world' },
      thirdParty: [],
    });
    expect(formatted).toContain('GET%20%2Fhello%20world');
  });

  test('empty baggage formats to empty string', () => {
    expect(formatBaggage({ sentry: {}, thirdParty: [] })).toBe('');
  });
});

describe('frozenness', () => {
  test('parsed result is frozen', () => {
    const b = parseBaggage('sentry-a=1,vendor-b=2');
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(b.sentry)).toBe(true);
    expect(Object.isFrozen(b.thirdParty)).toBe(true);
  });
});
