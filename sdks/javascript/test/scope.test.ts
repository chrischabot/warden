import { describe, expect, test } from 'bun:test';
import { Scope } from '../src/scope';
import type { Event } from '../src/types';

describe('Scope — setters', () => {
  test('chainable setters store values', () => {
    const s = new Scope()
      .setUser({ id: 'u1', email: 'a@b.com' })
      .setTag('region', 'eu-west')
      .setExtra('ctx', 42)
      .setLevel('warning')
      .setFingerprint(['custom']);
    expect(s.user?.id).toBe('u1');
    expect(s.tags.get('region')).toBe('eu-west');
    expect(s.extras.get('ctx')).toBe(42);
    expect(s.level).toBe('warning');
    expect(s.fingerprint).toEqual(['custom']);
  });

  test('setTags bulk-merges', () => {
    const s = new Scope().setTags({ a: '1', b: '2' });
    expect(s.tags.get('a')).toBe('1');
    expect(s.tags.get('b')).toBe('2');
  });

  test('null setters clear the field', () => {
    const s = new Scope().setUser({ id: 'x' }).setUser(null);
    expect(s.user).toBeUndefined();
    s.setLevel('error').setLevel(null);
    expect(s.level).toBeUndefined();
    s.setFingerprint(['x']).setFingerprint(null);
    expect(s.fingerprint).toBeUndefined();
  });

  test('clear wipes everything', () => {
    const s = new Scope()
      .setUser({ id: 'u' })
      .setTag('k', 'v')
      .setExtra('e', 1)
      .setContext('c', { x: 1 })
      .setLevel('error')
      .setFingerprint(['f']);
    s.clear();
    expect(s.user).toBeUndefined();
    expect(s.tags.size).toBe(0);
    expect(s.extras.size).toBe(0);
    expect(s.contexts.size).toBe(0);
    expect(s.level).toBeUndefined();
    expect(s.fingerprint).toBeUndefined();
  });
});

describe('Scope — clone', () => {
  test('clone preserves all fields', () => {
    const s = new Scope().setUser({ id: 'u' }).setTag('k', 'v');
    const c = s.clone();
    expect(c.user?.id).toBe('u');
    expect(c.tags.get('k')).toBe('v');
  });

  test('mutating clone does not affect original', () => {
    const s = new Scope().setTag('a', '1');
    const c = s.clone();
    c.setTag('a', '2').setTag('b', '3');
    expect(s.tags.get('a')).toBe('1');
    expect(s.tags.get('b')).toBeUndefined();
    expect(c.tags.get('a')).toBe('2');
    expect(c.tags.get('b')).toBe('3');
  });
});

describe('Scope — applyToEvent', () => {
  function baseEvent(): Event {
    return { event_id: 'x'.repeat(32), timestamp: '2024-01-01T00:00:00Z' };
  }

  test('adds user when event has none', () => {
    const s = new Scope().setUser({ id: 'u1' });
    const out = s.applyToEvent(baseEvent());
    expect(out.user?.id).toBe('u1');
  });

  test('event user wins over scope user', () => {
    const s = new Scope().setUser({ id: 'scope' });
    const out = s.applyToEvent({ ...baseEvent(), user: { id: 'event' } });
    expect(out.user?.id).toBe('event');
  });

  test('merges tags with event values winning', () => {
    const s = new Scope().setTag('a', 'scope-a').setTag('b', 'scope-b');
    const out = s.applyToEvent({ ...baseEvent(), tags: { a: 'event-a' } });
    expect(out.tags?.['a']).toBe('event-a');
    expect(out.tags?.['b']).toBe('scope-b');
  });

  test('adds level when event has none', () => {
    const s = new Scope().setLevel('warning');
    const out = s.applyToEvent(baseEvent());
    expect(out.level).toBe('warning');
  });

  test('preserves event level when set', () => {
    const s = new Scope().setLevel('warning');
    const out = s.applyToEvent({ ...baseEvent(), level: 'fatal' });
    expect(out.level).toBe('fatal');
  });

  test('adds fingerprint when event has none', () => {
    const s = new Scope().setFingerprint(['key-1', 'key-2']);
    const out = s.applyToEvent(baseEvent()) as { fingerprint?: readonly string[] };
    expect(out.fingerprint).toEqual(['key-1', 'key-2']);
  });

  test('merges contexts under contexts field', () => {
    const s = new Scope().setContext('os', { name: 'Linux' });
    const out = s.applyToEvent(baseEvent()) as { contexts?: Record<string, unknown> };
    expect(out.contexts?.['os']).toEqual({ name: 'Linux' });
  });
});
