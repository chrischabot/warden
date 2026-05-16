/**
 * Admin types per spec §5.13.
 *
 * Hierarchy:
 *
 *   Organization
 *     └── Team
 *           └── Project
 *
 *   User ↔ Organization (OrganizationMembership, with role)
 *   User ↔ Team         (TeamMembership, with role)
 *   ApiToken belongs to User, scoped to Organization (and optional projects).
 */

export type OrgRole = 'owner' | 'manager' | 'member' | 'billing' | 'admin';
export type TeamRole = 'admin' | 'member';

export interface Organization {
  readonly id: string;
  readonly slug: string;
  name: string;
  readonly createdAt: number;
}

export interface Team {
  readonly id: string;
  readonly organizationId: string;
  readonly slug: string;
  name: string;
  readonly createdAt: number;
}

export interface Project {
  readonly id: string;
  readonly organizationId: string;
  readonly slug: string;
  name: string;
  /** Teams that own this project. */
  readonly teamIds: ReadonlySet<string>;
  readonly platform: string;
  readonly createdAt: number;
}

export interface User {
  readonly id: string;
  readonly email: string;
  name?: string;
  readonly createdAt: number;
  isSuperuser: boolean;
}

export interface OrganizationMembership {
  readonly organizationId: string;
  readonly userId: string;
  role: OrgRole;
  readonly createdAt: number;
}

export interface TeamMembership {
  readonly teamId: string;
  readonly userId: string;
  role: TeamRole;
  readonly createdAt: number;
}

export type ApiTokenScope =
  | 'org:read'
  | 'org:admin'
  | 'project:read'
  | 'project:write'
  | 'project:admin'
  | 'event:read'
  | 'event:write'
  | 'event:admin';

export interface ApiToken {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly scopes: ReadonlySet<ApiTokenScope>;
  /** Optional restriction list; empty = all projects in the org. */
  readonly projectIds: ReadonlySet<string>;
  expiresAt?: number;
  lastUsedAt?: number;
  readonly createdAt: number;
}
