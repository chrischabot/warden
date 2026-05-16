import { beforeEach, describe, expect, test } from 'bun:test';
import { AuthError, DsnAuthenticator, MapProjectKeyRegistry } from '../src/index';

function regWith(...keys: Array<{ pid: string; oid: string; pk: string }>): MapProjectKeyRegistry {
  const r = new MapProjectKeyRegistry();
  for (const k of keys) {
    r.register({ projectId: k.pid, organizationId: k.oid, publicKey: k.pk });
  }
  return r;
}

describe('DsnAuthenticator.authenticateRequest', () => {
  let authn: DsnAuthenticator;
  beforeEach(() => {
    authn = new DsnAuthenticator(regWith({ pid: '42', oid: 'o1', pk: 'pubkey123' }));
  });

  test('happy path with X-Sentry-Auth header', () => {
    const ctx = authn.authenticateRequest({
      url: 'https://relay.example.com/api/42/envelope/',
      headers: {
        'X-Sentry-Auth': 'Sentry sentry_version=7,sentry_key=pubkey123,sentry_client=js/1.0',
      },
    });
    expect(ctx.method).toBe('dsn');
    expect(ctx.principal.kind).toBe('dsn');
    if (ctx.principal.kind === 'dsn') {
      expect(ctx.principal.projectId).toBe('42');
      expect(ctx.principal.organizationId).toBe('o1');
    }
  });

  test('happy path with ?sentry_key=... query param', () => {
    const ctx = authn.authenticateRequest({
      url: 'https://relay.example.com/api/42/envelope/?sentry_key=pubkey123',
      headers: {},
    });
    expect(ctx.principal.kind).toBe('dsn');
  });

  test('missing key → AuthError(missing)', () => {
    try {
      authn.authenticateRequest({
        url: 'https://relay.example.com/api/42/envelope/',
        headers: {},
      });
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).kind).toBe('missing');
      expect((e as AuthError).httpStatus).toBe(401);
    }
  });

  test('unknown key → AuthError(not_found)', () => {
    try {
      authn.authenticateRequest({
        url: 'https://relay.example.com/api/42/envelope/?sentry_key=unknown',
        headers: {},
      });
      expect(false).toBe(true);
    } catch (e) {
      expect((e as AuthError).kind).toBe('not_found');
      expect((e as AuthError).httpStatus).toBe(404);
    }
  });

  test('key + path mismatch → AuthError(forbidden)', () => {
    try {
      authn.authenticateRequest({
        url: 'https://relay.example.com/api/999/envelope/?sentry_key=pubkey123',
        headers: {},
      });
      expect(false).toBe(true);
    } catch (e) {
      expect((e as AuthError).kind).toBe('forbidden');
      expect((e as AuthError).httpStatus).toBe(403);
    }
  });

  test('unrecognised path shape → AuthError(invalid)', () => {
    try {
      authn.authenticateRequest({
        url: 'https://relay.example.com/api/users/?sentry_key=pubkey123',
        headers: {},
      });
      expect(false).toBe(true);
    } catch (e) {
      expect((e as AuthError).kind).toBe('invalid');
    }
  });

  test('header is case-insensitive', () => {
    const ctx = authn.authenticateRequest({
      url: 'https://relay.example.com/api/42/envelope/',
      headers: { 'x-sentry-auth': 'sentry_key=pubkey123' },
    });
    expect(ctx.principal.kind).toBe('dsn');
  });
});

describe('DsnAuthenticator.authenticateDsn', () => {
  test('parses + validates a DSN string', () => {
    const authn = new DsnAuthenticator(regWith({ pid: '7', oid: 'o', pk: 'abc' }));
    const ctx = authn.authenticateDsn('https://abc@relay.example.com/7');
    if (ctx.principal.kind === 'dsn') {
      expect(ctx.principal.projectId).toBe('7');
    }
  });

  test('rejects unknown public key', () => {
    const authn = new DsnAuthenticator(regWith({ pid: '7', oid: 'o', pk: 'abc' }));
    expect(() => authn.authenticateDsn('https://xyz@relay.example.com/7')).toThrow(AuthError);
  });
});

describe('MapProjectKeyRegistry', () => {
  test('register + lookup', () => {
    const r = new MapProjectKeyRegistry();
    expect(r.size()).toBe(0);
    r.register({ projectId: '1', organizationId: 'o', publicKey: 'k' });
    expect(r.findByPublicKey('k')?.projectId).toBe('1');
    expect(r.findByPublicKey('nope')).toBeUndefined();
  });
});
