/**
 * Role-based permission checks.
 *
 * Permission table (org-level):
 *
 *   owner:   manage everything, including ownership transfer
 *   manager: manage projects/teams/members; cannot delete the org or
 *            transfer ownership
 *   admin:   manage members + projects; cannot manage teams or billing
 *   member:  read everything; cannot manage
 *   billing: read billing; nothing else
 *
 * Team-level:
 *
 *   team-admin: manage team members and projects assigned to the team
 *   team-member: read/write events on team projects
 *
 * Sentry's role model is hierarchical: owner > manager > admin > member.
 */

import type { OrgRole, TeamRole } from './types';

export type OrgPermission =
  | 'org:read'
  | 'org:write'
  | 'org:delete'
  | 'org:transfer'
  | 'member:read'
  | 'member:invite'
  | 'member:remove'
  | 'team:read'
  | 'team:write'
  | 'project:read'
  | 'project:write'
  | 'project:delete'
  | 'billing:read'
  | 'billing:write';

const ORG_ROLE_PERMS: Readonly<Record<OrgRole, ReadonlySet<OrgPermission>>> = Object.freeze({
  owner: new Set<OrgPermission>([
    'org:read',
    'org:write',
    'org:delete',
    'org:transfer',
    'member:read',
    'member:invite',
    'member:remove',
    'team:read',
    'team:write',
    'project:read',
    'project:write',
    'project:delete',
    'billing:read',
    'billing:write',
  ]),
  manager: new Set<OrgPermission>([
    'org:read',
    'org:write',
    'member:read',
    'member:invite',
    'member:remove',
    'team:read',
    'team:write',
    'project:read',
    'project:write',
    'project:delete',
    'billing:read',
  ]),
  admin: new Set<OrgPermission>([
    'org:read',
    'member:read',
    'member:invite',
    'team:read',
    'project:read',
    'project:write',
  ]),
  member: new Set<OrgPermission>(['org:read', 'member:read', 'team:read', 'project:read']),
  billing: new Set<OrgPermission>(['org:read', 'billing:read', 'billing:write']),
});

export function orgCan(role: OrgRole, permission: OrgPermission): boolean {
  return (ORG_ROLE_PERMS[role] ?? new Set()).has(permission);
}

export type TeamPermission =
  | 'team:read'
  | 'team:manage'
  | 'team:project-assign'
  | 'event:read'
  | 'event:write';

const TEAM_ROLE_PERMS: Readonly<Record<TeamRole, ReadonlySet<TeamPermission>>> = Object.freeze({
  admin: new Set<TeamPermission>([
    'team:read',
    'team:manage',
    'team:project-assign',
    'event:read',
    'event:write',
  ]),
  member: new Set<TeamPermission>(['team:read', 'event:read', 'event:write']),
});

export function teamCan(role: TeamRole, permission: TeamPermission): boolean {
  return (TEAM_ROLE_PERMS[role] ?? new Set()).has(permission);
}

/** True iff `a` is at-least-as-privileged as `b` in the org role hierarchy. */
export function orgRoleAtLeast(a: OrgRole, b: OrgRole): boolean {
  return ORG_ROLE_RANK[a] >= ORG_ROLE_RANK[b];
}

const ORG_ROLE_RANK: Readonly<Record<OrgRole, number>> = Object.freeze({
  billing: 0,
  member: 1,
  admin: 2,
  manager: 3,
  owner: 4,
});
