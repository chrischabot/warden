import { describe, expect, test } from 'bun:test';
import { classify } from '../src/prober';

describe('classify — happy paths', () => {
  test('200 + fast response is up', () => {
    const c = classify({ httpStatus: 200, responseTimeMs: 100 }, {});
    expect(c.status).toBe('up');
  });

  test('200 + slow but not degraded is up', () => {
    const c = classify({ httpStatus: 200, responseTimeMs: 1000 }, {});
    expect(c.status).toBe('up');
  });
});

describe('classify — degraded', () => {
  test('response time ≥ degraded threshold is degraded', () => {
    const c = classify({ httpStatus: 200, responseTimeMs: 6000 }, { degradedThresholdMs: 5000 });
    expect(c.status).toBe('degraded');
  });
});

describe('classify — down', () => {
  test('HTTP error code is down', () => {
    const c = classify({ httpStatus: 500, responseTimeMs: 100 }, {});
    expect(c.status).toBe('down');
    expect(c.failureReason).toContain('HTTP 500');
  });

  test('network error is down', () => {
    const c = classify({ responseTimeMs: 0, errorMessage: 'ECONNREFUSED' }, {});
    expect(c.status).toBe('down');
  });

  test('response time ≥ down threshold is down', () => {
    const c = classify({ httpStatus: 200, responseTimeMs: 20_000 }, { downThresholdMs: 10_000 });
    expect(c.status).toBe('down');
  });

  test('missing body match is down', () => {
    const c = classify(
      { httpStatus: 200, responseTimeMs: 100, bodySample: 'unrelated' },
      { bodyContains: 'OK' },
    );
    expect(c.status).toBe('down');
  });

  test('custom status range honoured', () => {
    const c = classify(
      { httpStatus: 301, responseTimeMs: 50 },
      {
        statusMin: 200,
        statusMax: 299,
      },
    );
    expect(c.status).toBe('down');
    const cc = classify(
      { httpStatus: 301, responseTimeMs: 50 },
      {
        statusMin: 200,
        statusMax: 399,
      },
    );
    expect(cc.status).toBe('up');
  });
});
