# Auth

Source: [`packages/auth/`](../../packages/auth/).

Warden has three authentication models. The right one depends on which surface you're on.

| Surface                              | Auth                            |
| ------------------------------------ | ------------------------------- |
| Envelope ingest (SDK uploads)        | DSN public key                  |
| OTLP ingest                          | DSN public key                  |
| Read-side API                        | Bearer API token with scopes    |
| Web UI                               | Session cookie                  |
| Internal health / metrics             | None (bind to a private interface) |

## DSN authenticator

Source: [`packages/auth/src/dsn-authenticator.ts`](../../packages/auth/src/dsn-authenticator.ts).

A DSN encodes a project ID and a public key. The authenticator does two things:

1. **Extract the credential** from one of:
   - `X-Sentry-Auth` header (`Sentry sentry_key=<key>, sentry_version=7`).
   - `sentry_key` query parameter.
2. **Look up the `ProjectKey`** from the registry and validate it belongs to the `project_id` in the URL path.

```ts
interface DsnPrincipal {
  type: "dsn";
  projectId: string;
  organizationId: string;
  publicKey: string;
}
```

### `ProjectKey`

Each project has one or more keys (you may rotate or have per-environment keys):

```ts
interface ProjectKey {
  projectId: string;
  organizationId: string;
  publicKey: string;
  rateLimitOverride?: RateLimitRule;
  status: "active" | "disabled";
}
```

Disabled keys return `401`. Status changes are picked up at most every `WARDEN_KEY_CACHE_TTL_SECONDS` (default 60s) by the relay's key cache; rotate by adding a new active key first, then disabling the old one after deployments have updated.

## Token authenticator

Source: [`packages/auth/src/token-authenticator.ts`](../../packages/auth/src/token-authenticator.ts).

For read-side APIs and admin operations.

```ts
interface TokenPrincipal {
  type: "api-token";
  organizationId: string;
  userId?: string;            // null for bot/service tokens
  scopes: string[];
  projectIds?: string[];      // null = all projects in org
}
```

### Scopes

```
org:read        org:admin
project:read    project:write    project:admin
event:read      event:write      event:admin
```

Tokens are issued via **Settings → API tokens**. The token string is shown once at creation; only its hash is stored.

On every request the authenticator:

1. Reads `Authorization: Bearer <token>`.
2. Hashes the token (Bun.password / CryptoHasher).
3. Looks up the hash in the metadata store.
4. Returns the `TokenPrincipal` or rejects.

## Session authenticator

The web UI uses a session cookie issued by the auth flow (TBD; login UI is part of the in-progress read-API milestone). Same shape as `TokenPrincipal` but `type: "session"`.

## Scope check

Source: [`packages/auth/src/scope-check.ts`](../../packages/auth/src/scope-check.ts).

Endpoints declare required scopes:

```ts
requireScope(principal, "project:read", { projectId: "1" });
```

The check throws `AuthError` if:

- Principal is missing or expired (`401`).
- Principal lacks the required scope (`403`).
- Principal is scoped to specific projects and this project isn't one of them (`403`).
- The project does not exist (`404`).

## Errors

```ts
type AuthErrorKind =
  | "missing"        // 401
  | "invalid"        // 401
  | "expired"        // 401
  | "forbidden"      // 403
  | "not_found";     // 404
```

The relay translates these to HTTP responses with no body content beyond `{ error }`.

## Where to read next

- [`packages/auth/src/types.ts`](../../packages/auth/src/types.ts).
- [API: overview](../api/README.md) for which surface uses which auth.
