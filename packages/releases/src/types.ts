/**
 * Release types.
 *
 * Per spec §5.5: a Release is a version label attached to one or
 * more projects, with a set of Deploys (environment + datetime),
 * an optional commit log, and uploaded source-map / debug-id
 * Artifacts.
 */

export interface Release {
  readonly id: string;
  readonly version: string;
  readonly projectIds: ReadonlySet<string>;
  readonly createdAt: number;
  url?: string;
  dateReleased?: number;
  shortVersion?: string;
  /** Highest semver this release sorts after, if version is semver. */
  readonly semver?: ParsedSemver;
}

export interface Deploy {
  readonly id: string;
  readonly releaseVersion: string;
  readonly projectId: string;
  readonly environment: string;
  readonly deployedAt: number;
  name?: string;
  url?: string;
}

export interface Commit {
  readonly id: string; // sha
  readonly repoUrl: string;
  readonly authorEmail: string;
  authorName?: string;
  message: string;
  readonly timestamp: number;
}

export interface Artifact {
  readonly id: string;
  readonly releaseVersion: string;
  readonly projectId: string;
  readonly name: string; // logical path, e.g. "app.js"
  readonly fileSize: number;
  readonly sha1: string;
  /** Debug ID for source-map matching. */
  readonly debugId?: string;
  readonly uploadedAt: number;
}

export interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: string;
  readonly build: string;
}

export interface ReleaseQuery {
  readonly projectId?: string;
  readonly versionPrefix?: string;
  readonly environment?: string;
}

export interface DeployQuery {
  readonly releaseVersion?: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly since?: number;
  readonly until?: number;
}
