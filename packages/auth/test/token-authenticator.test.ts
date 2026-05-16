import { beforeEach, describe, expect, test } from 'bun:test';
import { AdminStore } from '@sr/admin';
import { type AuthError, TokenAuthenticator } from '../src/index';

describe('TokenAuthenticator', () => {
  let admin: AdminStore;
  let authn: TokenAuthenticator;
  let userId: string;
  let orgId: string;
  let now: number;

  beforeEach(() => {
    admin = new AdminStore();
    now = 1_000_000;
    authn = new TokenAuthenticator(admin, () => now);
    userId = admin.createUser({ email: 'a@b.com' }).id;
    orgId = admin.createOrganization({ slug: 'o', name: 'O', ownerUserId: userId }).id;
  });

  test('happy path with Bearer header', () => {
    const created = admin.createApiToken({
      organizationId: orgId,
      userId,
      scopes: ['org:read', 'project:write'],
    });
    const ctx = authn.authenticate({
      headers: { authorization: `Bearer ${created.rawToken}` },
    });
    expect(ctx.method).toBe('api-token');
    if (ctx.principal.kind === 'api-token') {
      expect(ctx.principal.tokenId).toBe(created.token.id);
      expect(ctx.principal.organizationId).toBe(orgId);
      expect(ctx.principal.userId).toBe(userId);
      expect(ctx.principal.scopes.has('project:write')).toBe(true);
    }
  });

  test('header is case-insensitive', () => {
    const created = admin.createApiToken({ organizationId: orgId, userId, scopes: [] });
    expect(() =>
      authn.authenticate({ headers: { Authorization: `bearer ${created.rawToken}` } }),
    ).not.toThrow();
  });

  test('missing header → AuthError(missing)', () => {
    try {
      authn.authenticate({ headers: {} });
      expect(false).toBe(true);
    } catch (e) {
      expect((e as AuthError).kind).toBe('missing');
    }
  });

  test('malformed header → AuthError(invalid)', () => {
    try {
      authn.authenticate({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });
      expect(false).toBe(true);
    } catch (e) {
      expect((e as AuthError).kind).toBe('invalid');
    }
  });

  test('bogus token → AuthError(invalid)', () => {
    try {
      authn.authenticate({ headers: { authorization: 'Bearer not-a-real-token' } });
      expect(false).toBe(true);
    } catch (e) {
      expect((e as AuthError).kind).toBe('invalid');
    }
  });

  test('expired token → AuthError(invalid)', () => {
    const created = admin.createApiToken({
      organizationId: orgId,
      userId,
      scopes: [],
      expiresAt: 500,
    });
    try {
      authn.authenticate({ headers: { authorization: `Bearer ${created.rawToken}` } });
      expect(false).toBe(true);
    } catch (e) {
      expect((e as AuthError).kind).toBe('invalid');
    }
  });

  test('authenticatedAt reflects the injected clock', () => {
    const created = admin.createApiToken({ organizationId: orgId, userId, scopes: [] });
    now = 12345;
    const ctx = authn.authenticate({ headers: { authorization: `Bearer ${created.rawToken}` } });
    expect(ctx.authenticatedAt).toBe(12345);
  });
});
