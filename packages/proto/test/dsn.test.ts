import { describe, expect, test } from 'bun:test';
import { DsnParseError, formatDsn, parseDsn } from '../src/dsn';

describe('parseDsn — valid', () => {
  test('minimal https with project id only', () => {
    const dsn = parseDsn('https://abc123@sentry.example.com/1');
    expect(dsn.scheme).toBe('https');
    expect(dsn.publicKey).toBe('abc123');
    expect(dsn.host).toBe('sentry.example.com');
    expect(dsn.projectId).toBe('1');
    expect(dsn.path).toBe('');
    expect(dsn.port).toBeUndefined();
    expect(dsn.secret).toBeUndefined();
    expect(dsn.envelopeUrl).toBe('https://sentry.example.com/api/1/envelope/');
    expect(dsn.storeUrl).toBe('https://sentry.example.com/api/1/store/');
  });

  test('http with secret, port, and path prefix', () => {
    const dsn = parseDsn('http://pk:sk@localhost:9000/api/v2/42');
    expect(dsn.scheme).toBe('http');
    expect(dsn.publicKey).toBe('pk');
    expect(dsn.secret).toBe('sk');
    expect(dsn.host).toBe('localhost');
    expect(dsn.port).toBe(9000);
    expect(dsn.path).toBe('/api/v2');
    expect(dsn.projectId).toBe('42');
    expect(dsn.envelopeUrl).toBe('http://localhost:9000/api/v2/api/42/envelope/');
  });

  test('large numeric project id is preserved as string', () => {
    const dsn = parseDsn('https://k@sentry.io/123456789012345');
    expect(dsn.projectId).toBe('123456789012345');
  });
});

describe('parseDsn — invalid', () => {
  test('empty input', () => {
    expect(() => parseDsn('')).toThrow(DsnParseError);
  });

  test('wrong scheme', () => {
    expect(() => parseDsn('ftp://k@host/1')).toThrow(DsnParseError);
  });

  test('missing project id', () => {
    expect(() => parseDsn('https://k@host/')).toThrow(DsnParseError);
    expect(() => parseDsn('https://k@host')).toThrow(DsnParseError);
  });

  test('non-numeric project id', () => {
    expect(() => parseDsn('https://k@host/abc')).toThrow(/project_id must be numeric/);
  });

  test('out-of-range port', () => {
    expect(() => parseDsn('https://k@host:99999/1')).toThrow(/port must be 1-65535/);
    expect(() => parseDsn('https://k@host:0/1')).toThrow(/port must be 1-65535/);
  });

  test('missing public key', () => {
    expect(() => parseDsn('https://@host/1')).toThrow(DsnParseError);
  });

  test('missing host', () => {
    expect(() => parseDsn('https://k@/1')).toThrow(DsnParseError);
  });
});

describe('formatDsn — round trips', () => {
  const cases = [
    'https://abc@sentry.io/1',
    'http://pk:sk@localhost:9000/api/v2/42',
    'https://abc@sentry.example.com:443/100',
    'https://k@host/api/proj/x/9999',
  ];
  for (const input of cases) {
    test(`round trip: ${input}`, () => {
      const dsn = parseDsn(input);
      const formatted = formatDsn(dsn);
      const reparsed = parseDsn(formatted);
      expect(reparsed).toEqual(dsn);
    });
  }
});

describe('parseDsn — frozenness', () => {
  test('result is frozen', () => {
    const dsn = parseDsn('https://k@h/1');
    expect(Object.isFrozen(dsn)).toBe(true);
  });
});
