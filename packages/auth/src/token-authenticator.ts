/**
 * API token authenticator.
 *
 * Reads `Authorization: Bearer <raw-token>` from the request and
 * delegates token lookup to the `AdminStore` (which keeps only the
 * hash, comparing on demand). The authenticator returns an
 * `AuthContext` carrying the principal's scopes and project
 * restrictions.
 *
 * Subsequent route-level guards consume `context.principal.scopes`
 * and `context.principal.projectIds` to authorise the call (see
 * `scope-check.ts`).
 */

import type { AdminStore } from '@sr/admin';
import type { AuthContext, TokenPrincipal } from './types';
import { AuthError } from './types';

export interface TokenAuthenticateInput {
  readonly headers: Readonly<Record<string, string>>;
}

const AUTHORIZATION = 'authorization';
const BEARER_PREFIX_RE = /^bearer\s+(.+)$/i;

export class TokenAuthenticator {
  constructor(
    public readonly admin: AdminStore,
    public readonly now: () => number = () => Date.now(),
  ) {}

  authenticate(input: TokenAuthenticateInput): AuthContext {
    const header = caseInsensitiveHeader(input.headers, AUTHORIZATION);
    if (!header) {
      throw new AuthError('missing', 'no Authorization header');
    }
    const match = BEARER_PREFIX_RE.exec(header);
    if (!match) {
      throw new AuthError('invalid', 'Authorization header must be "Bearer <token>"');
    }
    const raw = (match[1] as string).trim();
    if (!raw) {
      throw new AuthError('invalid', 'empty Bearer token');
    }
    const now = this.now();
    const token = this.admin.authenticateToken(raw, now);
    if (!token) {
      // The admin store returns undefined for both "not found" and
      // "expired"; we can disambiguate by looking up via the hash directly.
      throw new AuthError('invalid', 'invalid or expired token');
    }
    const principal: TokenPrincipal = {
      kind: 'api-token',
      tokenId: token.id,
      userId: token.userId,
      organizationId: token.organizationId,
      scopes: token.scopes,
      projectIds: token.projectIds,
    };
    return Object.freeze({
      method: 'api-token',
      principal,
      authenticatedAt: now,
    });
  }
}

function caseInsensitiveHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}
