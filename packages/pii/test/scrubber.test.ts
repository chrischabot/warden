import { describe, expect, test } from 'bun:test';
import { BUILTIN_PATTERNS } from '../src/patterns';
import { defaultScrubber, Scrubber } from '../src/scrubber';
import { BUILTIN_PATTERN_NAMES } from '../src/types';

describe('Scrubber — built-in patterns', () => {
  const s = defaultScrubber();

  test('redacts email', () => {
    expect(s.scrubString('contact alice@example.com please')).toBe('contact [Filtered] please');
  });

  test('redacts E.164 phone', () => {
    expect(s.scrubString('call +15551234567 now')).toBe('call [Filtered] now');
  });

  test('redacts SSN', () => {
    expect(s.scrubString('SSN 123-45-6789 here')).toBe('SSN [Filtered] here');
  });

  test('redacts Luhn-valid credit card', () => {
    expect(s.scrubString('card 4242 4242 4242 4242 thx')).toBe('card [Filtered] thx');
  });

  test('does NOT redact Luhn-invalid card-shaped run', () => {
    // Looks like a 16-digit number but fails Luhn:
    expect(s.scrubString('order 1234567890123456')).toBe('order 1234567890123456');
  });

  test('redacts IBAN', () => {
    // Example IBAN format (not a real account).
    expect(s.scrubString('IBAN DE89370400440532013000 ok')).toBe('IBAN [Filtered] ok');
  });

  test('redacts JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdC1zaWduYXR1cmU';
    expect(s.scrubString(`token=${jwt} done`)).toBe('token=[Filtered] done');
  });

  test('redacts Bearer token', () => {
    expect(s.scrubString('Authorization: Bearer sk_test_abc1234567890abcdef done')).toBe(
      'Authorization: [Filtered] done',
    );
  });

  test('redacts AWS access key', () => {
    expect(s.scrubString('AKIAIOSFODNN7EXAMPLE used')).toBe('[Filtered] used');
  });

  test('redacts AWS secret in URL query', () => {
    expect(
      s.scrubString('?aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY ok'),
    ).toBe('?[Filtered] ok');
  });

  test('redacts GCP service account email', () => {
    expect(s.scrubString('account my-svc@my-proj.iam.gserviceaccount.com error')).toBe(
      'account [Filtered] error',
    );
  });
});

describe('Scrubber — walker behaviour', () => {
  const s = defaultScrubber();

  test('walks into objects and arrays', () => {
    const input = {
      user: {
        name: 'alice',
        email: 'alice@example.com',
        phones: ['+15551234567', '+447911123456'],
        ssn: '123-45-6789',
      },
      orderId: 1234,
      tags: { region: 'us-east' },
    };
    const out = s.scrub(input);
    expect(out.user.email).toBe('[Filtered]');
    expect(out.user.phones).toEqual(['[Filtered]', '[Filtered]']);
    expect(out.user.ssn).toBe('[Filtered]');
    expect(out.user.name).toBe('alice');
    expect(out.orderId).toBe(1234);
    expect(out.tags.region).toBe('us-east');
  });

  test('does not mutate input', () => {
    const input = { email: 'a@b.com', list: ['c@d.com'] };
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
    s.scrub(input);
    expect(input).toEqual(snapshot);
  });

  test('idempotent: scrubbing twice = scrubbing once', () => {
    const input = { msg: 'email a@b.com and call +15551234567' };
    const once = s.scrub(input);
    const twice = s.scrub(once);
    expect(twice).toEqual(once);
  });

  test('non-string primitives pass through', () => {
    expect(s.scrub(42)).toBe(42);
    expect(s.scrub(true)).toBe(true);
    expect(s.scrub(null)).toBeNull();
    expect(s.scrub(undefined)).toBeUndefined();
  });

  test('multiple matches within one string all redact', () => {
    expect(s.scrubString('email a@b.com and c@d.com')).toBe('email [Filtered] and [Filtered]');
  });
});

describe('Scrubber — configuration', () => {
  test('enable=only keeps the listed builtins', () => {
    const s = new Scrubber({ enable: ['email'] });
    expect(s.scrubString('a@b.com and +15551234567')).toBe('[Filtered] and +15551234567');
  });

  test('disable removes specific builtins', () => {
    const s = new Scrubber({ disable: ['email'] });
    expect(s.scrubString('a@b.com and +15551234567')).toBe('a@b.com and [Filtered]');
  });

  test('custom replacement string', () => {
    const s = new Scrubber({ replacement: '[REDACTED]' });
    expect(s.scrubString('a@b.com')).toBe('[REDACTED]');
  });

  test('custom patterns', () => {
    const s = new Scrubber({
      enable: [],
      customPatterns: [{ name: 'order_id', regex: /ORD-\d{6}/g }],
    });
    expect(s.scrubString('see order ORD-123456 today')).toBe('see order [Filtered] today');
  });

  test('rejects custom pattern with name collision against a builtin', () => {
    expect(
      () =>
        new Scrubber({
          customPatterns: [{ name: 'email', regex: /x/g }],
        }),
    ).toThrow(/collision/);
  });

  test('rejects custom pattern without the global flag', () => {
    expect(
      () =>
        new Scrubber({
          customPatterns: [{ name: 'order_id', regex: /ORD-\d{6}/ }],
        }),
    ).toThrow(/global/);
  });
});

describe('Scrubber — BUILTIN_PATTERN_NAMES drift guard', () => {
  test('every name has a definition and vice versa', () => {
    const names = ([...BUILTIN_PATTERN_NAMES] as string[]).sort();
    const keys = Object.keys(BUILTIN_PATTERNS).sort();
    expect(names).toEqual(keys);
  });
});

describe('Scrubber — preserves surrounding context', () => {
  const s = defaultScrubber();

  test('replaces only the matching substring', () => {
    expect(s.scrubString('Error: connection refused by alice@example.com')).toBe(
      'Error: connection refused by [Filtered]',
    );
  });

  test('preserves keys when redacting values in objects', () => {
    const out = s.scrub({ email_address: 'alice@example.com' });
    expect(out).toEqual({ email_address: '[Filtered]' });
  });
});
