/**
 * Auth types per spec §7.
 *
 * Every authenticated request lands in an `AuthContext`. Routes
 * use this to decide:
 *
 *   - Which organisation / project the request operates on.
 *   - Which scopes the principal has been granted (matters when
 *     the principal is an API token).
 *   - Whether the principal is a real user, an API token, or an
 *     anonymous DSN (the latter two are what SDKs use).
 *
 * `AuthError.kind` discriminates so transport layers can map to
 * appropriate HTTP statuses:
 *
 *   missing → 401 Unauthorized (no credentials)
 *   invalid → 401 Unauthorized (bad credentials)
 *   expired → 401 Unauthorized (token past expiry)
 *   not_found → 404 Not Found (project / DSN unknown)
 *   forbidden → 403 Forbidden (auth ok but scope/role denies)
 */

import type { ApiTokenScope } from '@sr/admin';

export type AuthMethod = 'dsn' | 'api-token' | 'session';

export interface DsnPrincipal {
  readonly kind: 'dsn';
  readonly projectId: string;
  readonly organizationId: string;
  readonly publicKey: string;
}

export interface TokenPrincipal {
  readonly kind: 'api-token';
  readonly tokenId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly scopes: ReadonlySet<ApiTokenScope>;
  readonly projectIds: ReadonlySet<string>;
}

export interface SessionPrincipal {
  readonly kind: 'session';
  readonly userId: string;
  readonly organizationId: string;
}

export type Principal = DsnPrincipal | TokenPrincipal | SessionPrincipal;

export interface AuthContext {
  readonly method: AuthMethod;
  readonly principal: Principal;
  readonly authenticatedAt: number;
}

export type AuthErrorKind = 'missing' | 'invalid' | 'expired' | 'not_found' | 'forbidden';

export class AuthError extends Error {
  public readonly kind: AuthErrorKind;
  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
  }
  /** Map to a conventional HTTP status code. */
  get httpStatus(): number {
    switch (this.kind) {
      case 'missing':
      case 'invalid':
      case 'expired':
        return 401;
      case 'forbidden':
        return 403;
      case 'not_found':
        return 404;
      default:
        return 500;
    }
  }
}
