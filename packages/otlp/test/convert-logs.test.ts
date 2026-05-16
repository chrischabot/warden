import { describe, expect, test } from 'bun:test';
import type { LogLevel } from '@sr/logs';
import { convertLogsRequest } from '../src/convert-logs';
import type { ExportLogsServiceRequest, KeyValue, OtlpLogRecord } from '../src/types';

function record(overrides: Partial<OtlpLogRecord> = {}): OtlpLogRecord {
  return {
    timeUnixNano: '1700000000000000000',
    severityNumber: 9,
    body: { stringValue: 'hello' },
    ...overrides,
  };
}

function request(
  records: OtlpLogRecord[],
  resourceAttrs: Record<string, string> = {},
): ExportLogsServiceRequest {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: Object.entries(resourceAttrs).map(([key, value]) => ({
            key,
            value: { stringValue: value },
          })),
        },
        scopeLogs: [
          {
            scope: { name: 'app' },
            logRecords: records,
          },
        ],
      },
    ],
  };
}

describe('convertLogsRequest — severity decimation', () => {
  test.each<[number, LogLevel]>([
    [1, 'trace'],
    [4, 'trace'],
    [5, 'debug'],
    [8, 'debug'],
    [9, 'info'],
    [12, 'info'],
    [13, 'warning'],
    [16, 'warning'],
    [17, 'error'],
    [20, 'error'],
    [21, 'fatal'],
    [24, 'fatal'],
  ])('severityNumber=%i maps to %s', (severity, level) => {
    const out = convertLogsRequest(request([record({ severityNumber: severity })]), {
      projectId: '1',
    });
    expect(out.logs[0]?.level).toBe(level);
  });

  test('missing severity defaults to info', () => {
    const { severityNumber: _sev, ...noSev } = record();
    const out = convertLogsRequest(request([noSev as OtlpLogRecord]), {
      projectId: '1',
    });
    expect(out.logs[0]?.level).toBe('info');
  });
});

describe('convertLogsRequest — body extraction', () => {
  test('stringValue body passes verbatim', () => {
    const out = convertLogsRequest(request([record({ body: { stringValue: 'hi there' } })]), {
      projectId: '1',
    });
    expect(out.logs[0]?.message).toBe('hi there');
  });

  test('complex body JSON-stringifies', () => {
    const out = convertLogsRequest(
      request([
        record({
          body: {
            kvlistValue: {
              values: [{ key: 'k', value: { stringValue: 'v' } }],
            },
          },
        }),
      ]),
      { projectId: '1' },
    );
    expect(out.logs[0]?.message).toBe('{"k":"v"}');
  });

  test('missing body becomes empty string', () => {
    const { body: _body, ...noBody } = record();
    const out = convertLogsRequest(request([noBody as OtlpLogRecord]), { projectId: '1' });
    expect(out.logs[0]?.message).toBe('');
  });
});

describe('convertLogsRequest — attributes', () => {
  test('attributes are typed per OTLP scalar', () => {
    const attrs: KeyValue[] = [
      { key: 'foo', value: { stringValue: 'bar' } },
      { key: 'count', value: { intValue: '42' } },
      { key: 'ratio', value: { doubleValue: 0.5 } },
      { key: 'enabled', value: { boolValue: true } },
    ];
    const out = convertLogsRequest(request([record({ attributes: attrs })]), { projectId: '1' });
    const log = out.logs[0]!;
    expect(log.attributes?.['foo']).toEqual({ type: 'string', value: 'bar' });
    expect(log.attributes?.['count']).toEqual({ type: 'integer', value: 42 });
    expect(log.attributes?.['ratio']).toEqual({ type: 'double', value: 0.5 });
    expect(log.attributes?.['enabled']).toEqual({ type: 'boolean', value: true });
  });
});

describe('convertLogsRequest — trace correlation + resource', () => {
  test('traceId + spanId pass through', () => {
    const out = convertLogsRequest(
      request([
        record({
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          spanId: 'bbbbbbbbbbbbbbbb',
        }),
      ]),
      { projectId: '1' },
    );
    expect(out.logs[0]?.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(out.logs[0]?.spanId).toBe('bbbbbbbbbbbbbbbb');
  });

  test('resource release + environment propagate', () => {
    const out = convertLogsRequest(
      request([record({})], {
        'service.version': '1.0',
        'deployment.environment': 'staging',
      }),
      { projectId: '1' },
    );
    expect(out.logs[0]?.release).toBe('1.0');
    expect(out.logs[0]?.environment).toBe('staging');
  });

  test('timestamp converts from ns to ms', () => {
    const out = convertLogsRequest(request([record({ timeUnixNano: '1700000000123456789' })]), {
      projectId: '1',
    });
    expect(out.logs[0]?.timestamp).toBe(1_700_000_000_123);
  });
});
