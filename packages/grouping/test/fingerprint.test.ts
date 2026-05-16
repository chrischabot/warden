import { describe, expect, test } from 'bun:test';
import { fingerprintEvent } from '../src/fingerprint';
import type { Event } from '../src/types';

describe('fingerprintEvent — hierarchy: explicit fingerprint', () => {
  test('explicit fingerprint wins over everything', () => {
    const event: Event = {
      fingerprint: ['custom-key'],
      exception: {
        values: [
          { type: 'ValueError', value: 'bad', stacktrace: { frames: [{ function: 'foo' }] } },
        ],
      },
      message: 'hello',
    };
    const r = fingerprintEvent(event);
    expect(r.strategy).toBe('fingerprint');
    expect(r.fingerprint).toEqual(['custom-key']);
  });

  test('multi-component fingerprint', () => {
    const event: Event = { fingerprint: ['user', '123', 'logout'] };
    const r = fingerprintEvent(event);
    expect(r.fingerprint).toEqual(['user', '123', 'logout']);
  });
});

describe('fingerprintEvent — hierarchy: stacktrace', () => {
  test('uses top in-app frames from the most recent exception', () => {
    const event: Event = {
      platform: 'python',
      exception: {
        values: [
          {
            type: 'ValueError',
            value: 'bad input',
            stacktrace: {
              frames: [
                {
                  abs_path: '/usr/lib/python3.11/site-packages/django/views.py',
                  function: 'view_handler',
                },
                {
                  abs_path: '/srv/app/api/users.py',
                  module: 'app.api.users',
                  function: 'create_user',
                },
                {
                  abs_path: '/srv/app/api/users.py',
                  module: 'app.api.users',
                  function: 'validate_input',
                },
              ],
            },
          },
        ],
      },
    };
    const r = fingerprintEvent(event);
    expect(r.strategy).toBe('stacktrace');
    // Frames consumed top-of-stack first (last in the array).
    expect(r.fingerprint).toEqual([
      'frame:app.api.users|validate_input',
      'frame:app.api.users|create_user',
    ]);
  });

  test('falls through to exception when no in-app frames remain', () => {
    const event: Event = {
      platform: 'python',
      exception: {
        values: [
          {
            type: 'KeyError',
            value: 'missing',
            stacktrace: {
              frames: [
                { abs_path: '/usr/lib/python3.11/site-packages/lib/a.py', function: 'a' },
                { abs_path: '/usr/lib/python3.11/site-packages/lib/b.py', function: 'b' },
              ],
            },
          },
        ],
      },
    };
    const r = fingerprintEvent(event);
    expect(r.strategy).toBe('exception');
    expect(r.fingerprint).toEqual(['exception:KeyError', 'value:missing']);
  });

  test('top-level event.stacktrace when no exception interface', () => {
    const event: Event = {
      platform: 'go',
      stacktrace: {
        frames: [
          { function: 'runtime.gopanic' },
          { function: 'my_app/api/users.Create' },
          { function: 'my_app/api/users.validateInput' },
        ],
      },
    };
    const r = fingerprintEvent(event);
    expect(r.strategy).toBe('stacktrace');
    expect(r.fingerprint).toEqual([
      'frame:|my_app/api/users.validateInput',
      'frame:|my_app/api/users.Create',
    ]);
  });

  test('respects custom topFrames option', () => {
    const event: Event = {
      platform: 'rust',
      stacktrace: {
        frames: Array.from({ length: 10 }, (_, i) => ({ function: `my_app::layer_${i}` })),
      },
    };
    const r = fingerprintEvent(event, { topFrames: 3 });
    expect(r.strategy).toBe('stacktrace');
    expect(r.fingerprint.length).toBe(3);
    expect(r.fingerprint[0]).toBe('frame:|my_app::layer_9');
  });
});

describe('fingerprintEvent — hierarchy: exception type + value', () => {
  test('uses exception type and value when no stacktrace', () => {
    const event: Event = {
      exception: { values: [{ type: 'DatabaseError', value: 'connection refused' }] },
    };
    const r = fingerprintEvent(event);
    expect(r.strategy).toBe('exception');
    expect(r.fingerprint).toEqual(['exception:DatabaseError', 'value:connection refused']);
  });

  test('uses type only when value is absent', () => {
    const event: Event = { exception: { values: [{ type: 'TimeoutError' }] } };
    const r = fingerprintEvent(event);
    expect(r.fingerprint).toEqual(['exception:TimeoutError']);
  });

  test('skips empty exception value array', () => {
    const event: Event = { exception: { values: [] }, message: 'msg' };
    const r = fingerprintEvent(event);
    expect(r.strategy).toBe('message');
  });
});

describe('fingerprintEvent — hierarchy: message', () => {
  test('uses message when no fingerprint / exception', () => {
    const event: Event = { message: 'Database connection lost' };
    const r = fingerprintEvent(event);
    expect(r.strategy).toBe('message');
    expect(r.fingerprint).toEqual(['message:Database connection lost']);
  });

  test('empty message string falls to default', () => {
    const event: Event = { message: '' };
    const r = fingerprintEvent(event);
    expect(r.strategy).toBe('default');
  });
});

describe('fingerprintEvent — default fallback', () => {
  test('empty event uses default', () => {
    const r = fingerprintEvent({});
    expect(r.strategy).toBe('default');
    expect(r.fingerprint).toEqual(['default']);
  });
});

describe('fingerprintEvent — determinism', () => {
  test('same input → same hash', () => {
    const event: Event = { fingerprint: ['x', 'y', 'z'] };
    const a = fingerprintEvent(event);
    const b = fingerprintEvent(event);
    expect(a.groupHash).toBe(b.groupHash);
  });

  test('different inputs → different hashes', () => {
    const a = fingerprintEvent({ fingerprint: ['a'] });
    const b = fingerprintEvent({ fingerprint: ['b'] });
    expect(a.groupHash).not.toBe(b.groupHash);
  });

  test('groupHash is 16 lowercase hex chars', () => {
    const r = fingerprintEvent({ fingerprint: ['anything'] });
    expect(r.groupHash).toMatch(/^[0-9a-f]{16}$/);
  });

  test('result is frozen', () => {
    const r = fingerprintEvent({ fingerprint: ['x'] });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.fingerprint)).toBe(true);
  });
});

describe('fingerprintEvent — platform override via options', () => {
  test('options.platform overrides event.platform', () => {
    const event: Event = {
      platform: 'python',
      stacktrace: {
        frames: [{ function: 'std::panic::Location::caller' }, { function: 'my_app::main' }],
      },
    };
    // With python rules, std:: doesn't match python's system patterns,
    // so std::panic:: would be classified in-app. Overriding to rust
    // makes std:: system and only my_app::main is in-app.
    const r = fingerprintEvent(event, { platform: 'rust' });
    expect(r.strategy).toBe('stacktrace');
    expect(r.fingerprint).toEqual(['frame:|my_app::main']);
  });
});
