import { beforeEach, describe, expect, test } from 'bun:test';
import { AdminStore } from '../src/store';

describe('AdminStore — users', () => {
  let store: AdminStore;
  beforeEach(() => {
    store = new AdminStore();
  });

  test('createUser normalises email', () => {
    const u = store.createUser({ email: '  Alice@Example.com  ', name: 'Alice' });
    expect(u.email).toBe('alice@example.com');
    expect(store.getUserByEmail('alice@example.com')?.id).toBe(u.id);
  });

  test('duplicate email rejects', () => {
    store.createUser({ email: 'a@b.com' });
    expect(() => store.createUser({ email: 'A@B.COM' })).toThrow(RangeError);
  });

  test('setSuperuser toggles', () => {
    const u = store.createUser({ email: 'a@b.com' });
    store.setSuperuser(u.id, true);
    expect(store.getUser(u.id)?.isSuperuser).toBe(true);
  });
});

describe('AdminStore — organizations', () => {
  let store: AdminStore;
  let owner: string;
  beforeEach(() => {
    store = new AdminStore();
    owner = store.createUser({ email: 'owner@example.com' }).id;
  });

  test('createOrganization adds the owner as org owner', () => {
    const org = store.createOrganization({
      slug: 'acme',
      name: 'Acme',
      ownerUserId: owner,
    });
    const m = store.getOrgMembership(org.id, owner);
    expect(m?.role).toBe('owner');
  });

  test('slug must be lowercase, alpha-leading', () => {
    expect(() =>
      store.createOrganization({ slug: 'BadSlug', name: 'x', ownerUserId: owner }),
    ).toThrow(RangeError);
    expect(() =>
      store.createOrganization({ slug: '1acme', name: 'x', ownerUserId: owner }),
    ).toThrow(RangeError);
  });

  test('slug must be unique', () => {
    store.createOrganization({ slug: 'acme', name: 'A', ownerUserId: owner });
    expect(() => store.createOrganization({ slug: 'acme', name: 'B', ownerUserId: owner })).toThrow(
      RangeError,
    );
  });

  test('unknown owner rejects', () => {
    expect(() => store.createOrganization({ slug: 'x', name: 'X', ownerUserId: 'nope' })).toThrow(
      RangeError,
    );
  });
});

describe('AdminStore — teams', () => {
  let store: AdminStore;
  let orgId: string;
  let userId: string;

  beforeEach(() => {
    store = new AdminStore();
    userId = store.createUser({ email: 'u@x.com' }).id;
    orgId = store.createOrganization({ slug: 'o', name: 'O', ownerUserId: userId }).id;
  });

  test('create + lookup', () => {
    const t = store.createTeam({ organizationId: orgId, slug: 'platform', name: 'Platform' });
    expect(store.getTeam(t.id)?.name).toBe('Platform');
  });

  test('slug scoped to org', () => {
    store.createTeam({ organizationId: orgId, slug: 'p', name: 'P' });
    const otherUser = store.createUser({ email: 'b@x.com' }).id;
    const otherOrg = store.createOrganization({
      slug: 'o2',
      name: 'O2',
      ownerUserId: otherUser,
    }).id;
    expect(() =>
      store.createTeam({ organizationId: otherOrg, slug: 'p', name: 'P' }),
    ).not.toThrow();
    expect(() => store.createTeam({ organizationId: orgId, slug: 'p', name: 'P2' })).toThrow();
  });

  test('team membership requires org membership', () => {
    const t = store.createTeam({ organizationId: orgId, slug: 't', name: 'T' });
    const outsider = store.createUser({ email: 'outside@x.com' }).id;
    expect(() => store.addTeamMembership(t.id, outsider, 'member')).toThrow(RangeError);
    store.addOrgMembership(orgId, outsider, 'member');
    expect(() => store.addTeamMembership(t.id, outsider, 'member')).not.toThrow();
  });
});

describe('AdminStore — projects', () => {
  let store: AdminStore;
  let orgId: string;
  let teamId: string;

  beforeEach(() => {
    store = new AdminStore();
    const u = store.createUser({ email: 'a@b.com' }).id;
    orgId = store.createOrganization({ slug: 'org', name: 'O', ownerUserId: u }).id;
    teamId = store.createTeam({ organizationId: orgId, slug: 't', name: 'T' }).id;
  });

  test('create with team assignment', () => {
    const p = store.createProject({
      organizationId: orgId,
      slug: 'web',
      name: 'Web',
      platform: 'javascript',
      teamIds: [teamId],
    });
    expect(p.teamIds.has(teamId)).toBe(true);
  });

  test('cross-org team rejected', () => {
    const u2 = store.createUser({ email: 'c@d.com' }).id;
    const other = store.createOrganization({ slug: 'o2', name: 'O2', ownerUserId: u2 }).id;
    const t2 = store.createTeam({ organizationId: other, slug: 't2', name: 'T2' });
    expect(() =>
      store.createProject({
        organizationId: orgId,
        slug: 'x',
        name: 'X',
        platform: 'javascript',
        teamIds: [t2.id],
      }),
    ).toThrow(RangeError);
  });

  test('setProjectTeams replaces team set', () => {
    const p = store.createProject({
      organizationId: orgId,
      slug: 'web',
      name: 'Web',
      platform: 'javascript',
    });
    const t2 = store.createTeam({ organizationId: orgId, slug: 't2', name: 'T2' });
    const updated = store.setProjectTeams(p.id, [t2.id]);
    expect(updated.teamIds.has(teamId)).toBe(false);
    expect(updated.teamIds.has(t2.id)).toBe(true);
  });

  test('listProjectsForOrg filters', () => {
    store.createProject({ organizationId: orgId, slug: 'a', name: 'A', platform: 'js' });
    store.createProject({ organizationId: orgId, slug: 'b', name: 'B', platform: 'js' });
    expect(store.listProjectsForOrg(orgId).length).toBe(2);
  });
});

describe('AdminStore — API tokens', () => {
  let store: AdminStore;
  let orgId: string;
  let userId: string;

  beforeEach(() => {
    store = new AdminStore();
    userId = store.createUser({ email: 'u@x.com' }).id;
    orgId = store.createOrganization({ slug: 'o', name: 'O', ownerUserId: userId }).id;
  });

  test('create returns token metadata + raw secret', () => {
    const created = store.createApiToken({
      organizationId: orgId,
      userId,
      scopes: ['org:read', 'project:write'],
    });
    expect(created.token.scopes.has('project:write')).toBe(true);
    expect(typeof created.rawToken).toBe('string');
    expect(created.rawToken.length).toBeGreaterThan(20);
    expect(store.getApiToken(created.token.id)?.tokenHash).toBe(created.token.tokenHash);
  });

  test('createApiToken rejects non-member', () => {
    const outsider = store.createUser({ email: 'out@x.com' }).id;
    expect(() =>
      store.createApiToken({ organizationId: orgId, userId: outsider, scopes: [] }),
    ).toThrow(RangeError);
  });

  test('authenticateToken returns the token and updates lastUsedAt', () => {
    const created = store.createApiToken({
      organizationId: orgId,
      userId,
      scopes: ['event:read'],
    });
    const auth = store.authenticateToken(created.rawToken, 12_345);
    expect(auth?.id).toBe(created.token.id);
    expect(auth?.lastUsedAt).toBe(12_345);
    expect(store.getApiToken(created.token.id)?.lastUsedAt).toBe(12_345);
  });

  test('authenticateToken with bogus secret returns undefined', () => {
    store.createApiToken({ organizationId: orgId, userId, scopes: [] });
    expect(store.authenticateToken('not-a-real-token', 1)).toBeUndefined();
  });

  test('expired token does not authenticate', () => {
    const created = store.createApiToken({
      organizationId: orgId,
      userId,
      scopes: [],
      expiresAt: 500,
    });
    expect(store.authenticateToken(created.rawToken, 1000)).toBeUndefined();
    expect(store.authenticateToken(created.rawToken, 400)?.id).toBe(created.token.id);
  });

  test('raw secrets are unique across creations', () => {
    const a = store.createApiToken({ organizationId: orgId, userId, scopes: [] });
    const b = store.createApiToken({ organizationId: orgId, userId, scopes: [] });
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.token.tokenHash).not.toBe(b.token.tokenHash);
  });
});
