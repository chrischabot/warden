/**
 * Release / Deploy / Commit / Artifact store.
 *
 * Releases are keyed by `version`. Per spec a release is shared
 * across multiple projects, so `release.projectIds` is a Set
 * grown by `attachProject(version, projectId)`.
 *
 * Deploys are keyed by `(release_version, project_id, environment,
 * deployed_at)` — a deploy is a single (env, version, project,
 * timestamp) tuple. Multiple deploys can exist for the same
 * (release, env) pair (re-deploys); the latest one is the canonical
 * "current deploy".
 *
 * Commits are keyed by `(repo_url, sha)`. A commit may belong to
 * many releases.
 *
 * Artifacts are keyed by `(release_version, project_id, name)`
 * with overwrite-on-re-upload semantics, plus an optional
 * `debug_id` index for source-map lookups by id.
 */

import { compareSemver, parseSemver } from './semver';
import type { Artifact, Commit, Deploy, DeployQuery, Release, ReleaseQuery } from './types';

let monoCounter = 0;
function nextId(prefix: string): string {
  monoCounter++;
  return `${prefix}_${Date.now().toString(36)}_${monoCounter.toString(36)}`;
}

export interface CreateReleaseInput {
  readonly version: string;
  readonly projectId: string;
  readonly url?: string;
  readonly shortVersion?: string;
  readonly dateReleased?: number;
}

export interface CreateDeployInput {
  readonly releaseVersion: string;
  readonly projectId: string;
  readonly environment: string;
  readonly deployedAt?: number;
  readonly name?: string;
  readonly url?: string;
}

export interface CreateArtifactInput {
  readonly releaseVersion: string;
  readonly projectId: string;
  readonly name: string;
  readonly fileSize: number;
  readonly sha1: string;
  readonly debugId?: string;
  readonly uploadedAt?: number;
}

export class ReleaseStore {
  private readonly releases = new Map<string, Release>();
  private readonly deploys = new Map<string, Deploy>();
  private readonly commits = new Map<string, Commit>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly artifactsByDebugId = new Map<string, Artifact>();
  private readonly releaseToCommits = new Map<string, Set<string>>();
  private readonly now: () => number;

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  // ---- releases ----

  upsertRelease(input: CreateReleaseInput): Release {
    const existing = this.releases.get(input.version);
    if (existing) {
      const projectIds = new Set(existing.projectIds);
      projectIds.add(input.projectId);
      const updated: Release = {
        ...existing,
        projectIds,
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.shortVersion !== undefined ? { shortVersion: input.shortVersion } : {}),
        ...(input.dateReleased !== undefined ? { dateReleased: input.dateReleased } : {}),
      };
      this.releases.set(input.version, updated);
      return updated;
    }
    const semver = parseSemver(input.version);
    const created: Release = {
      id: nextId('rel'),
      version: input.version,
      projectIds: new Set([input.projectId]),
      createdAt: this.now(),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.shortVersion !== undefined ? { shortVersion: input.shortVersion } : {}),
      ...(input.dateReleased !== undefined ? { dateReleased: input.dateReleased } : {}),
      ...(semver ? { semver } : {}),
    };
    this.releases.set(input.version, created);
    return created;
  }

  attachProject(version: string, projectId: string): Release {
    const existing = this.releases.get(version);
    if (!existing) {
      throw new RangeError(`ReleaseStore: no release with version "${version}"`);
    }
    const projectIds = new Set(existing.projectIds);
    projectIds.add(projectId);
    const updated: Release = { ...existing, projectIds };
    this.releases.set(version, updated);
    return updated;
  }

  getRelease(version: string): Release | undefined {
    return this.releases.get(version);
  }

  /** List releases. Default sort: semver desc, then createdAt desc. */
  listReleases(query: ReleaseQuery = {}): Release[] {
    const out: Release[] = [];
    for (const r of this.releases.values()) {
      if (query.projectId !== undefined && !r.projectIds.has(query.projectId)) continue;
      if (query.versionPrefix !== undefined && !r.version.startsWith(query.versionPrefix)) {
        continue;
      }
      if (query.environment !== undefined) {
        // Has any deploy in that environment?
        const hasEnv = [...this.deploys.values()].some(
          (d) => d.releaseVersion === r.version && d.environment === query.environment,
        );
        if (!hasEnv) continue;
      }
      out.push(r);
    }
    out.sort((a, b) => {
      const cmp = compareSemver(a.version, b.version);
      if (cmp !== 0) return -cmp; // semver desc
      return b.createdAt - a.createdAt;
    });
    return out;
  }

  // ---- deploys ----

  recordDeploy(input: CreateDeployInput): Deploy {
    if (!this.releases.has(input.releaseVersion)) {
      throw new RangeError(
        `ReleaseStore.recordDeploy: release "${input.releaseVersion}" not found`,
      );
    }
    const deployedAt = input.deployedAt ?? this.now();
    const deploy: Deploy = {
      id: nextId('dep'),
      releaseVersion: input.releaseVersion,
      projectId: input.projectId,
      environment: input.environment,
      deployedAt,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
    };
    this.deploys.set(deploy.id, deploy);
    return deploy;
  }

  listDeploys(query: DeployQuery = {}): Deploy[] {
    const out: Deploy[] = [];
    for (const d of this.deploys.values()) {
      if (query.releaseVersion !== undefined && d.releaseVersion !== query.releaseVersion) {
        continue;
      }
      if (query.projectId !== undefined && d.projectId !== query.projectId) continue;
      if (query.environment !== undefined && d.environment !== query.environment) {
        continue;
      }
      if (query.since !== undefined && d.deployedAt < query.since) continue;
      if (query.until !== undefined && d.deployedAt > query.until) continue;
      out.push(d);
    }
    out.sort((a, b) => b.deployedAt - a.deployedAt);
    return out;
  }

  /** Current (latest) deploy for a (release, env) pair on a specific project. */
  currentDeploy(
    releaseVersion: string,
    environment: string,
    projectId: string,
  ): Deploy | undefined {
    const candidates = this.listDeploys({
      releaseVersion,
      environment,
      projectId,
    });
    return candidates[0];
  }

  // ---- commits ----

  upsertCommit(commit: Commit, releaseVersion?: string): Commit {
    const key = commitKey(commit.repoUrl, commit.id);
    this.commits.set(key, commit);
    if (releaseVersion) {
      const set = this.releaseToCommits.get(releaseVersion) ?? new Set<string>();
      set.add(key);
      this.releaseToCommits.set(releaseVersion, set);
    }
    return commit;
  }

  associateCommits(releaseVersion: string, commits: Iterable<Commit>): number {
    let added = 0;
    for (const c of commits) {
      this.upsertCommit(c, releaseVersion);
      added++;
    }
    return added;
  }

  listCommits(releaseVersion: string): Commit[] {
    const keys = this.releaseToCommits.get(releaseVersion);
    if (!keys) return [];
    const out: Commit[] = [];
    for (const k of keys) {
      const c = this.commits.get(k);
      if (c) out.push(c);
    }
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out;
  }

  // ---- artifacts ----

  upsertArtifact(input: CreateArtifactInput): Artifact {
    if (!this.releases.has(input.releaseVersion)) {
      throw new RangeError(
        `ReleaseStore.upsertArtifact: release "${input.releaseVersion}" not found`,
      );
    }
    const key = artifactKey(input.releaseVersion, input.projectId, input.name);
    const a: Artifact = {
      id: nextId('art'),
      releaseVersion: input.releaseVersion,
      projectId: input.projectId,
      name: input.name,
      fileSize: input.fileSize,
      sha1: input.sha1,
      ...(input.debugId ? { debugId: input.debugId } : {}),
      uploadedAt: input.uploadedAt ?? this.now(),
    };
    this.artifacts.set(key, a);
    if (a.debugId) {
      this.artifactsByDebugId.set(a.debugId, a);
    }
    return a;
  }

  getArtifact(releaseVersion: string, projectId: string, name: string): Artifact | undefined {
    return this.artifacts.get(artifactKey(releaseVersion, projectId, name));
  }

  getArtifactByDebugId(debugId: string): Artifact | undefined {
    return this.artifactsByDebugId.get(debugId);
  }

  listArtifacts(releaseVersion: string, projectId: string): Artifact[] {
    const prefix = `${releaseVersion}\u0000${projectId}\u0000`;
    const out: Artifact[] = [];
    for (const [k, v] of this.artifacts.entries()) {
      if (k.startsWith(prefix)) out.push(v);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
}

function commitKey(repoUrl: string, sha: string): string {
  return `${repoUrl}\u0000${sha}`;
}

function artifactKey(releaseVersion: string, projectId: string, name: string): string {
  return `${releaseVersion}\u0000${projectId}\u0000${name}`;
}
