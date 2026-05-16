import { describe, expect, test } from 'bun:test';
import {
  attributesToRecord,
  decodeLogsRequest,
  decodeTraceRequest,
  extractValue,
  OtlpDecodeError,
  unixNanoToMs,
} from '../src/decode-json';
import type { AnyValue, KeyValue } from '../src/types';

describe('extractValue', () => {
  test('stringValue', () => {
    expect(extractValue({ stringValue: 'hi' })).toBe('hi');
  });
  test('boolValue', () => {
    expect(extractValue({ boolValue: true })).toBe(true);
  });
  test('intValue from string', () => {
    expect(extractValue({ intValue: '42' })).toBe(42);
  });
  test('intValue from number', () => {
    expect(extractValue({ intValue: 42 })).toBe(42);
  });
  test('doubleValue', () => {
    expect(extractValue({ doubleValue: 3.14 })).toBeCloseTo(3.14, 5);
  });
  test('arrayValue recurses', () => {
    const av: AnyValue = {
      arrayValue: { values: [{ stringValue: 'a' }, { intValue: '1' }] },
    };
    expect(extractValue(av)).toEqual(['a', 1]);
  });
  test('kvlistValue produces record', () => {
    const av: AnyValue = {
      kvlistValue: {
        values: [
          { key: 'k1', value: { stringValue: 'v1' } },
          { key: 'k2', value: { boolValue: false } },
        ],
      },
    };
    expect(extractValue(av)).toEqual({ k1: 'v1', k2: false });
  });
  test('undefined input is undefined', () => {
    expect(extractValue(undefined)).toBeUndefined();
  });
  test('empty AnyValue is undefined', () => {
    expect(extractValue({})).toBeUndefined();
  });
});

describe('attributesToRecord', () => {
  test('builds a flat record', () => {
    const attrs: KeyValue[] = [
      { key: 'service.name', value: { stringValue: 'web' } },
      { key: 'span.count', value: { intValue: '7' } },
    ];
    expect(attributesToRecord(attrs)).toEqual({ 'service.name': 'web', 'span.count': 7 });
  });
  test('empty / undefined return {}', () => {
    expect(attributesToRecord(undefined)).toEqual({});
    expect(attributesToRecord([])).toEqual({});
  });
});

describe('unixNanoToMs', () => {
  test('numeric nanos (within safe-int range)', () => {
    expect(unixNanoToMs(1_700_000_123_456_789)).toBe(1_700_000_123);
  });
  test('string nanos preserves precision for ns beyond 2^53', () => {
    expect(unixNanoToMs('1700000000123456789')).toBe(1_700_000_000_123);
  });
  test('undefined returns 0', () => {
    expect(unixNanoToMs(undefined)).toBe(0);
  });
  test('garbage string returns 0', () => {
    expect(unixNanoToMs('not-a-number')).toBe(0);
  });
});

describe('decodeTraceRequest / decodeLogsRequest', () => {
  test('accepts string input', () => {
    const obj = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [],
        },
      ],
    };
    const decoded = decodeTraceRequest(JSON.stringify(obj));
    expect(decoded.resourceSpans.length).toBe(1);
  });

  test('accepts Uint8Array input', () => {
    const obj = { resourceLogs: [] };
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    expect(decodeLogsRequest(bytes).resourceLogs).toEqual([]);
  });

  test('rejects invalid JSON', () => {
    expect(() => decodeTraceRequest('not json')).toThrow(OtlpDecodeError);
  });
});
