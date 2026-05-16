/**
 * Sentry DSN parser.
 *
 * Format: `<scheme>://<public_key>[:<secret>]@<host>[:<port>][/<path>]/<project_id>`
 *
 * Examples:
 *   `https://abc123@sentry.example.com/1`
 *   `https://abc123:def456@sentry.example.com:8443/api/2`
 *
 * The path's last numeric segment is the project_id; everything
 * before is an optional path prefix kept as-is.
 *
 * Host syntax: hostname and IPv4 literal hosts are supported.
 * IPv6 literal hosts (e.g. `https://k@[::1]/1`) are out of scope
 * for P0; add bracketed-host parsing if a real use case surfaces.
 */

export interface Dsn {
  readonly scheme: 'http' | 'https';
  readonly publicKey: string;
  readonly secret?: string;
  readonly host: string;
  readonly port?: number;
  /** '' or '/foo' — no trailing project id. */
  readonly path: string;
  /** Decimal-digit string; never numeric to preserve leading zeros / bigints. */
  readonly projectId: string;
  /** Full envelope endpoint URL. */
  readonly envelopeUrl: string;
  /** Full store endpoint URL (legacy). */
  readonly storeUrl: string;
}

export class DsnParseError extends Error {
  public readonly input: string;
  constructor(message: string, input: string) {
    super(message);
    this.name = 'DsnParseError';
    this.input = input;
  }
}

const DSN_RE = /^(https?):\/\/([^:@/]+)(?::([^@/]+))?@([^:/]+)(?::(\d+))?(\/.*)?$/;

export function parseDsn(input: string): Dsn {
  if (typeof input !== 'string' || input.length === 0) {
    throw new DsnParseError('DSN must be a non-empty string', String(input));
  }
  const m = DSN_RE.exec(input.trim());
  if (!m) {
    throw new DsnParseError('DSN does not match expected pattern', input);
  }
  const scheme = m[1] as 'http' | 'https';
  const publicKey = m[2] as string;
  const secret = m[3];
  const host = m[4] as string;
  const portStr = m[5];
  const fullPath = m[6] ?? '/';

  const segments = fullPath.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new DsnParseError('DSN must include a project id', input);
  }
  const projectId = segments[segments.length - 1] as string;
  if (!/^\d+$/.test(projectId)) {
    throw new DsnParseError(`DSN project_id must be numeric, got "${projectId}"`, input);
  }
  const pathPrefix = segments.length > 1 ? '/' + segments.slice(0, -1).join('/') : '';

  let port: number | undefined;
  if (portStr !== undefined) {
    const p = Number.parseInt(portStr, 10);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      throw new DsnParseError(`DSN port must be 1-65535, got "${portStr}"`, input);
    }
    port = p;
  }

  const portSuffix = port !== undefined ? `:${port}` : '';
  const base = `${scheme}://${host}${portSuffix}${pathPrefix}`;
  const envelopeUrl = `${base}/api/${projectId}/envelope/`;
  const storeUrl = `${base}/api/${projectId}/store/`;

  return Object.freeze({
    scheme,
    publicKey,
    ...(secret ? { secret } : {}),
    host,
    ...(port !== undefined ? { port } : {}),
    path: pathPrefix,
    projectId,
    envelopeUrl,
    storeUrl,
  });
}

export function formatDsn(dsn: Dsn): string {
  const auth = dsn.secret ? `${dsn.publicKey}:${dsn.secret}` : dsn.publicKey;
  const port = dsn.port !== undefined ? `:${dsn.port}` : '';
  return `${dsn.scheme}://${auth}@${dsn.host}${port}${dsn.path}/${dsn.projectId}`;
}
