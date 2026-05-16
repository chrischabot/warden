/**
 * DSN authenticator for SDK-side ingest.
 *
 * Wire format: the SDK includes the DSN in a `sentry_key=...,
 * sentry_secret=...,sentry_version=7` header (or in the URL path
 * for legacy clients). This authenticator works from either
 * source:
 *
 *   - `authenticateRequest(req)` reads the `X-Sentry-Auth` header
 *     or the `sentry_key` query parameter, then validates the
 *     project_id from the URL path against the public key.
 *
 *   - `authenticateDsn(rawDsn)` is the simpler form used by tests
 *     and the relay's internal accept-anything mode.
 *
 * The `ProjectKeyRegistry` interface lets the relay defer to a
 * shared admin store; tests inject an in-memory implementation.
 */

import { parseDsn } from '@sr/proto';
import type { AuthContext, DsnPrincipal } from './types';
import { AuthError } from './types';

export interface ProjectKey {
  readonly projectId: string;
  readonly organizationId: string;
  readonly publicKey: string;
}

export interface ProjectKeyRegistry {
  findByPublicKey(publicKey: string): ProjectKey | undefined;
}

export interface AuthenticateRequestInput {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const X_SENTRY_AUTH = 'x-sentry-auth';
const SENTRY_KEY_RE = /sentry_key\s*=\s*([^,\s]+)/;

export class DsnAuthenticator {
  constructor(public readonly registry: ProjectKeyRegistry) {}

  /** Authenticate an HTTP request to `/api/{project_id}/envelope/`. */
  authenticateRequest(input: AuthenticateRequestInput): AuthContext {
    const publicKey = extractPublicKey(input);
    if (!publicKey) {
      throw new AuthError('missing', 'no DSN public key in request');
    }
    const url = new URL(input.url);
    const match = /^\/api\/(\d+)\/(?:envelope|store)\/?$/.exec(url.pathname);
    if (!match) {
      throw new AuthError('invalid', `unrecognised ingest path: ${url.pathname}`);
    }
    const projectId = match[1] as string;

    const key = this.registry.findByPublicKey(publicKey);
    if (!key) {
      throw new AuthError('not_found', `unknown DSN public key`);
    }
    if (key.projectId !== projectId) {
      throw new AuthError(
        'forbidden',
        `DSN key belongs to project ${key.projectId}, not ${projectId}`,
      );
    }
    const principal: DsnPrincipal = {
      kind: 'dsn',
      projectId: key.projectId,
      organizationId: key.organizationId,
      publicKey: key.publicKey,
    };
    return Object.freeze({
      method: 'dsn',
      principal,
      authenticatedAt: Date.now(),
    });
  }

  /** Lower-level: validate a raw DSN string. */
  authenticateDsn(rawDsn: string): AuthContext {
    const parsed = parseDsn(rawDsn);
    const key = this.registry.findByPublicKey(parsed.publicKey);
    if (!key) {
      throw new AuthError('not_found', `unknown DSN public key`);
    }
    if (key.projectId !== parsed.projectId) {
      throw new AuthError(
        'forbidden',
        `DSN key belongs to project ${key.projectId}, not ${parsed.projectId}`,
      );
    }
    const principal: DsnPrincipal = {
      kind: 'dsn',
      projectId: key.projectId,
      organizationId: key.organizationId,
      publicKey: key.publicKey,
    };
    return Object.freeze({
      method: 'dsn',
      principal,
      authenticatedAt: Date.now(),
    });
  }
}

function extractPublicKey(input: AuthenticateRequestInput): string | undefined {
  // Header has priority.
  const header = caseInsensitiveHeader(input.headers, X_SENTRY_AUTH);
  if (header) {
    const m = SENTRY_KEY_RE.exec(header);
    if (m) return m[1] as string;
  }
  // Fallback: ?sentry_key=...
  const url = new URL(input.url);
  const queryKey = url.searchParams.get('sentry_key');
  if (queryKey) return queryKey;
  return undefined;
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

/** Convenience in-memory registry. */
export class MapProjectKeyRegistry implements ProjectKeyRegistry {
  private readonly byKey = new Map<string, ProjectKey>();
  register(key: ProjectKey): void {
    this.byKey.set(key.publicKey, key);
  }
  findByPublicKey(publicKey: string): ProjectKey | undefined {
    return this.byKey.get(publicKey);
  }
  size(): number {
    return this.byKey.size;
  }
}
