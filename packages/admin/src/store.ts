/**
 * Admin store.
 *
 * Holds every administrative entity in memory. The store guards
 * referential integrity (org-of-team, org-of-project, team-of-project),
 * unique slugs within scope, and one-membership-per-user-per-org.
 */

import type {
  ApiToken,
  ApiTokenScope,
  Organization,
  OrganizationMembership,
  OrgRole,
  Project,
  Team,
  TeamMembership,
  TeamRole,
  User,
} from './types';

let monoCounter = 0;
function nextId(prefix: string): string {
  monoCounter++;
  return `${prefix}_${Date.now().toString(36)}_${monoCounter.toString(36)}`;
}

const SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;
function checkSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new RangeError(`AdminStore: slug "${slug}" must match /^[a-z][a-z0-9-]{0,31}$/`);
  }
}

export interface CreateOrgInput {
  readonly slug: string;
  readonly name: string;
  /** User who creates the org becomes its owner. */
  readonly ownerUserId: string;
}

export interface CreateTeamInput {
  readonly organizationId: string;
  readonly slug: string;
  readonly name: string;
}

export interface CreateProjectInput {
  readonly organizationId: string;
  readonly slug: string;
  readonly name: string;
  readonly platform: string;
  readonly teamIds?: readonly string[];
}

export interface CreateUserInput {
  readonly email: string;
  readonly name?: string;
}

export interface CreateApiTokenInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly scopes: readonly ApiTokenScope[];
  readonly projectIds?: readonly string[];
  readonly expiresAt?: number;
}

/**
 * Result of `createApiToken`. The `rawToken` is returned exactly once
 * and never again — the store only retains its hash.
 */
export interface CreatedApiToken {
  readonly token: ApiToken;
  readonly rawToken: string;
}

export class AdminStore {
  private readonly orgs = new Map<string, Organization>();
  private readonly orgBySlug = new Map<string, string>();
  private readonly teams = new Map<string, Team>();
  private readonly teamBySlug = new Map<string, string>(); // org+slug -> id
  private readonly projects = new Map<string, Project>();
  private readonly projectBySlug = new Map<string, string>();
  private readonly users = new Map<string, User>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly orgMemberships = new Map<string, OrganizationMembership>();
  private readonly teamMemberships = new Map<string, TeamMembership>();
  private readonly apiTokens = new Map<string, ApiToken>();
  private readonly tokensByHash = new Map<string, string>();

  // ---- users ----

  createUser(input: CreateUserInput): User {
    const norm = input.email.trim().toLowerCase();
    if (this.usersByEmail.has(norm)) {
      throw new RangeError(`AdminStore: user with email "${input.email}" already exists`);
    }
    const id = nextId('usr');
    const user: User = {
      id,
      email: norm,
      ...(input.name !== undefined ? { name: input.name } : {}),
      createdAt: Date.now(),
      isSuperuser: false,
    };
    this.users.set(id, user);
    this.usersByEmail.set(norm, id);
    return user;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  getUserByEmail(email: string): User | undefined {
    const id = this.usersByEmail.get(email.trim().toLowerCase());
    return id ? this.users.get(id) : undefined;
  }

  setSuperuser(userId: string, isSuperuser: boolean): User {
    const u = this.requireUser(userId);
    u.isSuperuser = isSuperuser;
    return u;
  }

  // ---- organizations ----

  createOrganization(input: CreateOrgInput): Organization {
    checkSlug(input.slug);
    if (this.orgBySlug.has(input.slug)) {
      throw new RangeError(`AdminStore: organization slug "${input.slug}" already exists`);
    }
    this.requireUser(input.ownerUserId);
    const id = nextId('org');
    const org: Organization = {
      id,
      slug: input.slug,
      name: input.name,
      createdAt: Date.now(),
    };
    this.orgs.set(id, org);
    this.orgBySlug.set(input.slug, id);
    this.addOrgMembership(id, input.ownerUserId, 'owner');
    return org;
  }

  getOrganization(id: string): Organization | undefined {
    return this.orgs.get(id);
  }

  getOrganizationBySlug(slug: string): Organization | undefined {
    const id = this.orgBySlug.get(slug);
    return id ? this.orgs.get(id) : undefined;
  }

  // ---- teams ----

  createTeam(input: CreateTeamInput): Team {
    checkSlug(input.slug);
    this.requireOrg(input.organizationId);
    const key = `${input.organizationId}\u0000${input.slug}`;
    if (this.teamBySlug.has(key)) {
      throw new RangeError(`AdminStore: team slug "${input.slug}" already exists in org`);
    }
    const id = nextId('tm');
    const team: Team = {
      id,
      organizationId: input.organizationId,
      slug: input.slug,
      name: input.name,
      createdAt: Date.now(),
    };
    this.teams.set(id, team);
    this.teamBySlug.set(key, id);
    return team;
  }

  getTeam(id: string): Team | undefined {
    return this.teams.get(id);
  }

  // ---- projects ----

  createProject(input: CreateProjectInput): Project {
    checkSlug(input.slug);
    this.requireOrg(input.organizationId);
    const key = `${input.organizationId}\u0000${input.slug}`;
    if (this.projectBySlug.has(key)) {
      throw new RangeError(`AdminStore: project slug "${input.slug}" already exists in org`);
    }
    const teamIds = new Set<string>();
    for (const tid of input.teamIds ?? []) {
      const team = this.requireTeam(tid);
      if (team.organizationId !== input.organizationId) {
        throw new RangeError(`AdminStore: team "${tid}" belongs to a different organisation`);
      }
      teamIds.add(tid);
    }
    const id = nextId('proj');
    const project: Project = {
      id,
      organizationId: input.organizationId,
      slug: input.slug,
      name: input.name,
      teamIds,
      platform: input.platform,
      createdAt: Date.now(),
    };
    this.projects.set(id, project);
    this.projectBySlug.set(key, id);
    return project;
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  /** Mutate a project's team set. */
  setProjectTeams(projectId: string, teamIds: readonly string[]): Project {
    const project = this.requireProject(projectId);
    const next = new Set<string>();
    for (const tid of teamIds) {
      const team = this.requireTeam(tid);
      if (team.organizationId !== project.organizationId) {
        throw new RangeError(`AdminStore: team "${tid}" belongs to a different organisation`);
      }
      next.add(tid);
    }
    const updated: Project = { ...project, teamIds: next };
    this.projects.set(projectId, updated);
    return updated;
  }

  listProjectsForOrg(organizationId: string): readonly Project[] {
    const out: Project[] = [];
    for (const p of this.projects.values()) {
      if (p.organizationId === organizationId) out.push(p);
    }
    return Object.freeze(out);
  }

  // ---- memberships ----

  addOrgMembership(organizationId: string, userId: string, role: OrgRole): OrganizationMembership {
    this.requireOrg(organizationId);
    this.requireUser(userId);
    const key = membershipKey(organizationId, userId);
    if (this.orgMemberships.has(key)) {
      throw new RangeError(
        `AdminStore: user "${userId}" is already a member of organisation "${organizationId}"`,
      );
    }
    const m: OrganizationMembership = {
      organizationId,
      userId,
      role,
      createdAt: Date.now(),
    };
    this.orgMemberships.set(key, m);
    return m;
  }

  setOrgRole(organizationId: string, userId: string, role: OrgRole): OrganizationMembership {
    const m = this.orgMemberships.get(membershipKey(organizationId, userId));
    if (!m) {
      throw new RangeError(
        `AdminStore: user "${userId}" is not a member of organisation "${organizationId}"`,
      );
    }
    m.role = role;
    return m;
  }

  getOrgMembership(organizationId: string, userId: string): OrganizationMembership | undefined {
    return this.orgMemberships.get(membershipKey(organizationId, userId));
  }

  listOrgMembers(organizationId: string): readonly OrganizationMembership[] {
    const out: OrganizationMembership[] = [];
    for (const m of this.orgMemberships.values()) {
      if (m.organizationId === organizationId) out.push(m);
    }
    return Object.freeze(out);
  }

  addTeamMembership(teamId: string, userId: string, role: TeamRole): TeamMembership {
    const team = this.requireTeam(teamId);
    this.requireUser(userId);
    // User must already be a member of the team's organisation.
    if (!this.orgMemberships.has(membershipKey(team.organizationId, userId))) {
      throw new RangeError(
        `AdminStore: user "${userId}" must be a member of org "${team.organizationId}" before joining team "${teamId}"`,
      );
    }
    const key = teamMembershipKey(teamId, userId);
    if (this.teamMemberships.has(key)) {
      throw new RangeError(`AdminStore: user "${userId}" already on team "${teamId}"`);
    }
    const m: TeamMembership = {
      teamId,
      userId,
      role,
      createdAt: Date.now(),
    };
    this.teamMemberships.set(key, m);
    return m;
  }

  getTeamMembership(teamId: string, userId: string): TeamMembership | undefined {
    return this.teamMemberships.get(teamMembershipKey(teamId, userId));
  }

  // ---- API tokens ----

  createApiToken(input: CreateApiTokenInput): CreatedApiToken {
    this.requireOrg(input.organizationId);
    this.requireUser(input.userId);
    if (!this.orgMemberships.has(membershipKey(input.organizationId, input.userId))) {
      throw new RangeError(
        `AdminStore: user "${input.userId}" is not a member of org "${input.organizationId}"`,
      );
    }
    const id = nextId('tkn');
    const rawToken = `srt_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
    const tokenHash = hashToken(rawToken);
    const token: ApiToken = {
      id,
      organizationId: input.organizationId,
      userId: input.userId,
      tokenHash,
      scopes: new Set(input.scopes),
      projectIds: new Set(input.projectIds ?? []),
      createdAt: Date.now(),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };
    this.apiTokens.set(id, token);
    this.tokensByHash.set(tokenHash, id);
    return { token, rawToken };
  }

  getApiToken(id: string): ApiToken | undefined {
    return this.apiTokens.get(id);
  }

  /** Lookup by the hashed token, marking lastUsedAt. */
  authenticateToken(rawToken: string, now: number): ApiToken | undefined {
    const id = this.tokensByHash.get(hashToken(rawToken));
    if (!id) return undefined;
    const token = this.apiTokens.get(id);
    if (!token) return undefined;
    if (token.expiresAt !== undefined && token.expiresAt < now) return undefined;
    token.lastUsedAt = now;
    return token;
  }

  // ---- internals ----

  private requireUser(id: string): User {
    const u = this.users.get(id);
    if (!u) throw new RangeError(`AdminStore: no user with id ${id}`);
    return u;
  }

  private requireOrg(id: string): Organization {
    const o = this.orgs.get(id);
    if (!o) throw new RangeError(`AdminStore: no organisation with id ${id}`);
    return o;
  }

  private requireTeam(id: string): Team {
    const t = this.teams.get(id);
    if (!t) throw new RangeError(`AdminStore: no team with id ${id}`);
    return t;
  }

  private requireProject(id: string): Project {
    const p = this.projects.get(id);
    if (!p) throw new RangeError(`AdminStore: no project with id ${id}`);
    return p;
  }
}

function membershipKey(orgId: string, userId: string): string {
  return `${orgId}\u0000${userId}`;
}

function teamMembershipKey(teamId: string, userId: string): string {
  return `${teamId}\u0000${userId}`;
}

/** Token hashing — non-crypto, just keeps raw tokens out of memory. */
function hashToken(raw: string): string {
  const h = (Bun.hash as (data: string) => bigint)(raw);
  return h.toString(16).padStart(16, '0');
}
