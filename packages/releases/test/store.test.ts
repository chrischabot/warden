import { beforeEach, describe, expect, test } from 'bun:test';
import { ReleaseStore } from '../src/store';

describe('ReleaseStore — releases', () => {
  let store: ReleaseStore;
  beforeEach(() => {
    store = new ReleaseStore();
  });

  test('upsert creates a new release', () => {
    const r = store.upsertRelease({ version: '1.0.0', projectId: '1' });
    expect(r.version).toBe('1.0.0');
    expect(r.projectIds.has('1')).toBe(true);
    expect(r.semver?.major).toBe(1);
  });

  test('second upsert with same version attaches project', () => {
    store.upsertRelease({ version: '1.0.0', projectId: '1' });
    const r = store.upsertRelease({ version: '1.0.0', projectId: '2' });
    expect(r.projectIds.size).toBe(2);
  });

  test('attachProject on unknown version throws', () => {
    expect(() => store.attachProject('1.0.0', '1')).toThrow(RangeError);
  });

  test('non-semver versions still create records', () => {
    const r = store.upsertRelease({ version: 'commit-deadbeef', projectId: '1' });
    expect(r.semver).toBeUndefined();
  });

  test('list filters by project', () => {
    store.upsertRelease({ version: '1.0.0', projectId: '1' });
    store.upsertRelease({ version: '2.0.0', projectId: '2' });
    expect(store.listReleases({ projectId: '1' }).length).toBe(1);
    expect(store.listReleases({ projectId: '2' }).length).toBe(1);
  });

  test('list sorts semver desc', () => {
    store.upsertRelease({ version: '1.0.0', projectId: '1' });
    store.upsertRelease({ version: '2.0.0', projectId: '1' });
    store.upsertRelease({ version: '1.5.0', projectId: '1' });
    const versions = store.listReleases({ projectId: '1' }).map((r) => r.version);
    expect(versions).toEqual(['2.0.0', '1.5.0', '1.0.0']);
  });

  test('list ranks semver above non-semver', () => {
    store.upsertRelease({ version: 'foo', projectId: '1' });
    store.upsertRelease({ version: '1.0.0', projectId: '1' });
    const versions = store.listReleases({ projectId: '1' }).map((r) => r.version);
    expect(versions[0]).toBe('1.0.0');
  });
});

describe('ReleaseStore — deploys', () => {
  let store: ReleaseStore;
  beforeEach(() => {
    store = new ReleaseStore();
    store.upsertRelease({ version: '1.0.0', projectId: '1' });
  });

  test('record + list', () => {
    store.recordDeploy({
      releaseVersion: '1.0.0',
      projectId: '1',
      environment: 'production',
      deployedAt: 1000,
    });
    const deploys = store.listDeploys();
    expect(deploys.length).toBe(1);
    expect(deploys[0]?.environment).toBe('production');
  });

  test('refuses deploys for missing release', () => {
    expect(() =>
      store.recordDeploy({ releaseVersion: '9.9.9', projectId: '1', environment: 'prod' }),
    ).toThrow(RangeError);
  });

  test('listDeploys filters by env', () => {
    store.recordDeploy({ releaseVersion: '1.0.0', projectId: '1', environment: 'prod' });
    store.recordDeploy({ releaseVersion: '1.0.0', projectId: '1', environment: 'staging' });
    expect(store.listDeploys({ environment: 'prod' }).length).toBe(1);
  });

  test('currentDeploy picks the latest by deployedAt', () => {
    store.recordDeploy({
      releaseVersion: '1.0.0',
      projectId: '1',
      environment: 'prod',
      deployedAt: 1_000,
    });
    store.recordDeploy({
      releaseVersion: '1.0.0',
      projectId: '1',
      environment: 'prod',
      deployedAt: 2_000,
    });
    expect(store.currentDeploy('1.0.0', 'prod', '1')?.deployedAt).toBe(2_000);
  });
});

describe('ReleaseStore — commits', () => {
  let store: ReleaseStore;
  beforeEach(() => {
    store = new ReleaseStore();
    store.upsertRelease({ version: '1.0.0', projectId: '1' });
  });

  test('associate + list', () => {
    store.associateCommits('1.0.0', [
      {
        id: 'abc',
        repoUrl: 'r',
        authorEmail: 'a@b',
        message: 'first',
        timestamp: 1000,
      },
      {
        id: 'def',
        repoUrl: 'r',
        authorEmail: 'a@b',
        message: 'second',
        timestamp: 2000,
      },
    ]);
    const commits = store.listCommits('1.0.0');
    expect(commits.map((c) => c.id)).toEqual(['def', 'abc']); // newest first
  });

  test('listCommits unknown release returns empty', () => {
    expect(store.listCommits('does-not-exist')).toEqual([]);
  });
});

describe('ReleaseStore — artifacts', () => {
  let store: ReleaseStore;
  beforeEach(() => {
    store = new ReleaseStore();
    store.upsertRelease({ version: '1.0.0', projectId: '1' });
  });

  test('upsert + lookup by name', () => {
    store.upsertArtifact({
      releaseVersion: '1.0.0',
      projectId: '1',
      name: 'app.js',
      fileSize: 1234,
      sha1: 's1',
    });
    expect(store.getArtifact('1.0.0', '1', 'app.js')?.fileSize).toBe(1234);
  });

  test('re-upload overwrites by (release, project, name)', () => {
    store.upsertArtifact({
      releaseVersion: '1.0.0',
      projectId: '1',
      name: 'app.js',
      fileSize: 100,
      sha1: 's1',
    });
    store.upsertArtifact({
      releaseVersion: '1.0.0',
      projectId: '1',
      name: 'app.js',
      fileSize: 200,
      sha1: 's2',
    });
    expect(store.getArtifact('1.0.0', '1', 'app.js')?.sha1).toBe('s2');
    expect(store.listArtifacts('1.0.0', '1').length).toBe(1);
  });

  test('debug_id index allows lookup by uuid', () => {
    store.upsertArtifact({
      releaseVersion: '1.0.0',
      projectId: '1',
      name: 'app.js',
      fileSize: 100,
      sha1: 's1',
      debugId: '11111111-2222-3333-4444-555555555555',
    });
    const a = store.getArtifactByDebugId('11111111-2222-3333-4444-555555555555');
    expect(a?.name).toBe('app.js');
  });

  test('artifact for unknown release rejects', () => {
    expect(() =>
      store.upsertArtifact({
        releaseVersion: '9.9.9',
        projectId: '1',
        name: 'x',
        fileSize: 0,
        sha1: 's',
      }),
    ).toThrow(RangeError);
  });

  test('list returns only artifacts for that release+project', () => {
    store.upsertRelease({ version: '2.0.0', projectId: '1' });
    store.upsertArtifact({
      releaseVersion: '1.0.0',
      projectId: '1',
      name: 'app.js',
      fileSize: 1,
      sha1: '1',
    });
    store.upsertArtifact({
      releaseVersion: '2.0.0',
      projectId: '1',
      name: 'app.js',
      fileSize: 2,
      sha1: '2',
    });
    expect(store.listArtifacts('1.0.0', '1').length).toBe(1);
    expect(store.listArtifacts('2.0.0', '1').length).toBe(1);
  });
});
