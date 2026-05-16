import { describe, expect, test } from 'bun:test';
import type { ApiTokenScope } from '@sr/admin';
import { AuthError, hasScope, requireProjectAccess, requireScope } from '../src/index';
import type { AuthContext } from '../src/types';

function tokenCtx(scopes: ApiTokenScope[], projectIds: string[] = []): AuthContext {
  return {
    method: 'api-token',
    principal: {
      kind: 'api-token',
      tokenId: 't1',
      userId: 'u1',
      organizationId: 'o1',
      scopes: new Set(scopes),
      projectIds: new Set(projectIds),
    },
    authenticatedAt: 0,
  };
}

function dsnCtx(projectId: string): AuthContext {
  return {
    method: 'dsn',
    principal: {
      kind: 'dsn',
      projectId,
      organizationId: 'o1',
      publicKey: 'k',
    },
    authenticatedAt: 0,
  };
}

function sessionCtx(): AuthContext {
  return {
    method: 'session',
    principal: { kind: 'session', userId: 'u1', organizationId: 'o1' },
    authenticatedAt: 0,
  };
}

describe('hasScope — implication chain', () => {
  test('event:admin implies event:write implies event:read', () => {
    const granted = new Set<ApiTokenScope>(['event:admin']);
    expect(hasScope(granted, 'event:admin')).toBe(true);
    expect(hasScope(granted, 'event:write')).toBe(true);
    expect(hasScope(granted, 'event:read')).toBe(true);
  });

  test('event:write does not imply event:admin', () => {
    const granted = new Set<ApiTokenScope>(['event:write']);
    expect(hasScope(granted, 'event:admin')).toBe(false);
    expect(hasScope(granted, 'event:write')).toBe(true);
    expect(hasScope(granted, 'event:read')).toBe(true);
  });

  test('project:admin implies project:write and project:read', () => {
    const granted = new Set<ApiTokenScope>(['project:admin']);
    expect(hasScope(granted, 'project:write')).toBe(true);
    expect(hasScope(granted, 'project:read')).toBe(true);
  });

  test('org:read does not cross over to project:* or event:*', () => {
    const granted = new Set<ApiTokenScope>(['org:read']);
    expect(hasScope(granted, 'org:read')).toBe(true);
    expect(hasScope(granted, 'project:read')).toBe(false);
    expect(hasScope(granted, 'event:read')).toBe(false);
  });
});

describe('requireScope — token principals', () => {
  test('passes when scope is granted', () => {
    const ctx = tokenCtx(['event:write']);
    expect(() => requireScope(ctx, 'event:read')).not.toThrow();
  });

  test('throws forbidden when scope missing', () => {
    const ctx = tokenCtx(['event:read']);
    try {
      requireScope(ctx, 'event:write');
      expect(false).toBe(true);
    } catch (e) {
      expect((e as AuthError).kind).toBe('forbidden');
    }
  });

  test('project restriction: empty set means all projects', () => {
    const ctx = tokenCtx(['event:write'], []);
    expect(() => requireScope(ctx, 'event:write', '42')).not.toThrow();
  });

  test('project restriction: explicit list must include requested project', () => {
    const ctx = tokenCtx(['event:write'], ['7']);
    expect(() => requireScope(ctx, 'event:write', '7')).not.toThrow();
    expect(() => requireScope(ctx, 'event:write', '42')).toThrow(AuthError);
  });
});

describe('requireScope — DSN principals', () => {
  test('event:write on own project passes', () => {
    const ctx = dsnCtx('42');
    expect(() => requireScope(ctx, 'event:write', '42')).not.toThrow();
  });

  test('event:read on own project passes', () => {
    const ctx = dsnCtx('42');
    expect(() => requireScope(ctx, 'event:read', '42')).not.toThrow();
  });

  test('non-event scopes forbidden', () => {
    const ctx = dsnCtx('42');
    expect(() => requireScope(ctx, 'org:read')).toThrow(AuthError);
    expect(() => requireScope(ctx, 'project:write')).toThrow(AuthError);
  });

  test('different project forbidden', () => {
    const ctx = dsnCtx('42');
    expect(() => requireScope(ctx, 'event:write', '99')).toThrow(AuthError);
  });
});

describe('requireScope — session principals', () => {
  test('session pass-through (session authn handled elsewhere)', () => {
    const ctx = sessionCtx();
    for (const scope of ['org:read', 'project:write', 'event:admin'] as const) {
      expect(() => requireScope(ctx, scope)).not.toThrow();
    }
  });
});

describe('requireProjectAccess', () => {
  test('DSN must match its bound project', () => {
    const ctx = dsnCtx('42');
    expect(() => requireProjectAccess(ctx, '42')).not.toThrow();
    expect(() => requireProjectAccess(ctx, '99')).toThrow(AuthError);
  });

  test('token: empty projectIds = all access', () => {
    const ctx = tokenCtx(['event:write'], []);
    expect(() => requireProjectAccess(ctx, '99')).not.toThrow();
  });

  test('token: restricted list', () => {
    const ctx = tokenCtx(['event:write'], ['7']);
    expect(() => requireProjectAccess(ctx, '7')).not.toThrow();
    expect(() => requireProjectAccess(ctx, '8')).toThrow(AuthError);
  });

  test('session is pass-through', () => {
    expect(() => requireProjectAccess(sessionCtx(), '42')).not.toThrow();
  });
});
