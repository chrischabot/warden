/**
 * Scope-based authorization.
 *
 * `requireScope(context, scope, projectId?)` throws AuthError if
 * the principal lacks the named API-token scope, or is operating
 * on a project the token isn't permitted to access. DSN principals
 * pass `event:read` and `event:write` on their own bound project
 * and fail every other scope check.
 *
 * Session principals pass any scope check (they're real users
 * whose authorization is delegated to the org-role permission
 * model in @sr/admin).
 */

import type { ApiTokenScope } from '@sr/admin';
import type { AuthContext } from './types';
import { AuthError } from './types';

/**
 * Strict ordering — `event:admin` implies `event:write` implies
 * `event:read`. Returning a Set we can membership-test against.
 */
const SCOPE_IMPLIES: Readonly<Record<ApiTokenScope, readonly ApiTokenScope[]>> = Object.freeze({
  'org:admin': ['org:admin', 'org:read'],
  'org:read': ['org:read'],
  'project:admin': ['project:admin', 'project:write', 'project:read'],
  'project:write': ['project:write', 'project:read'],
  'project:read': ['project:read'],
  'event:admin': ['event:admin', 'event:write', 'event:read'],
  'event:write': ['event:write', 'event:read'],
  'event:read': ['event:read'],
});

export function requireScope(context: AuthContext, scope: ApiTokenScope, projectId?: string): void {
  const principal = context.principal;
  if (principal.kind === 'session') {
    // Sessions delegate to the org-role model; we don't enforce
    // ApiTokenScope on them.
    return;
  }
  if (principal.kind === 'dsn') {
    if (scope !== 'event:write' && scope !== 'event:read') {
      throw new AuthError(
        'forbidden',
        `DSN principals are restricted to event:read / event:write, asked for ${scope}`,
      );
    }
    if (projectId !== undefined && projectId !== principal.projectId) {
      throw new AuthError(
        'forbidden',
        `DSN principal cannot operate on project ${projectId}; bound to ${principal.projectId}`,
      );
    }
    return;
  }
  // api-token principal
  if (!hasScope(principal.scopes, scope)) {
    throw new AuthError('forbidden', `token lacks required scope: ${scope}`);
  }
  if (projectId !== undefined && principal.projectIds.size > 0) {
    if (!principal.projectIds.has(projectId)) {
      throw new AuthError('forbidden', `token not authorised for project ${projectId}`);
    }
  }
}

export function hasScope(granted: ReadonlySet<ApiTokenScope>, needed: ApiTokenScope): boolean {
  for (const g of granted) {
    const implied = SCOPE_IMPLIES[g] ?? [];
    if (implied.includes(needed)) return true;
  }
  return false;
}

/** Project-scope check for DSN principals. Returns the bound project_id or throws. */
export function requireProjectAccess(context: AuthContext, projectId: string): void {
  const principal = context.principal;
  if (principal.kind === 'dsn') {
    if (principal.projectId !== projectId) {
      throw new AuthError(
        'forbidden',
        `DSN bound to project ${principal.projectId}, asked for ${projectId}`,
      );
    }
    return;
  }
  if (principal.kind === 'api-token') {
    if (principal.projectIds.size > 0 && !principal.projectIds.has(projectId)) {
      throw new AuthError('forbidden', `token not authorised for project ${projectId}`);
    }
    return;
  }
  // Sessions are bound by their organization but project access is
  // handled at the route level via @sr/admin's org-role helpers.
}
