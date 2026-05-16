import { describe, expect, test } from 'bun:test';
import {
  eventFromException,
  eventFromMessage,
  eventToItemPayload,
  newEventId,
  nowIso,
} from '../src/event';

describe('newEventId', () => {
  test('produces 32 lowercase hex chars', () => {
    const id = newEventId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test('produces unique ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(newEventId());
    expect(ids.size).toBe(100);
  });
});

describe('nowIso', () => {
  test('looks like an ISO 8601 timestamp', () => {
    const t = nowIso();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('eventFromException', () => {
  test('extracts type and value from Error', () => {
    const ev = eventFromException(new Error('boom'));
    expect(ev.exception?.values[0]?.type).toBe('Error');
    expect(ev.exception?.values[0]?.value).toBe('boom');
    expect(ev.level).toBe('error');
    expect(ev.platform).toBe('javascript');
    expect(ev.sdk?.name).toBe('sentry-replica.javascript');
  });

  test('parses stack when present', () => {
    function inner() {
      throw new Error('thrown');
    }
    let err: unknown;
    try {
      inner();
    } catch (e) {
      err = e;
    }
    const ev = eventFromException(err);
    expect(ev.exception?.values[0]?.stacktrace?.frames.length).toBeGreaterThan(0);
  });

  test('coerces non-Error to Error', () => {
    const ev = eventFromException('a string oops');
    expect(ev.exception?.values[0]?.type).toBe('Error');
    expect(ev.exception?.values[0]?.value).toBe('a string oops');
  });

  test('coerces plain object with message', () => {
    const ev = eventFromException({ name: 'CustomError', message: 'has message' });
    expect(ev.exception?.values[0]?.type).toBe('CustomError');
    expect(ev.exception?.values[0]?.value).toBe('has message');
  });

  test('honors level option', () => {
    const ev = eventFromException(new Error('warn'), { level: 'warning' });
    expect(ev.level).toBe('warning');
  });

  test('honors tags/extra/user options', () => {
    const ev = eventFromException(new Error('x'), {
      tags: { request_id: 'abc' },
      extra: { ctx: 1 },
      user: { id: 'u-123' },
    });
    expect(ev.tags?.['request_id']).toBe('abc');
    expect(ev.extra?.['ctx']).toBe(1);
    expect(ev.user?.id).toBe('u-123');
  });
});

describe('eventFromMessage', () => {
  test('uses message field with info level', () => {
    const ev = eventFromMessage('hello world');
    expect(ev.message).toBe('hello world');
    expect(ev.exception).toBeUndefined();
  });

  test('honors level override', () => {
    const ev = eventFromMessage('warn me', { level: 'warning' });
    expect(ev.level).toBe('warning');
  });
});

describe('eventToItemPayload', () => {
  test('encodes event JSON to bytes', () => {
    const ev = eventFromMessage('hi');
    const item = eventToItemPayload(ev);
    expect(item.type).toBe('event');
    const decoded = new TextDecoder().decode(item.payload);
    const parsed = JSON.parse(decoded) as { message: string };
    expect(parsed.message).toBe('hi');
  });
});
