import { describe, expect, test } from 'bun:test';
import { compareSemver, parseSemver } from '../src/semver';

describe('parseSemver — happy paths', () => {
  test('parses MAJOR.MINOR.PATCH', () => {
    const p = parseSemver('1.2.3');
    expect(p).toEqual({ major: 1, minor: 2, patch: 3, pre: '', build: '' });
  });

  test('parses pre-release', () => {
    const p = parseSemver('1.0.0-alpha.1');
    expect(p?.pre).toBe('alpha.1');
  });

  test('parses build metadata', () => {
    const p = parseSemver('1.0.0+build.42');
    expect(p?.build).toBe('build.42');
  });

  test('parses pre-release + build', () => {
    const p = parseSemver('1.0.0-rc.1+build.42');
    expect(p?.pre).toBe('rc.1');
    expect(p?.build).toBe('build.42');
  });
});

describe('parseSemver — rejection', () => {
  test('rejects missing patch', () => {
    expect(parseSemver('1.2')).toBeUndefined();
  });

  test('rejects leading zero', () => {
    expect(parseSemver('1.02.3')).toBeUndefined();
  });

  test('rejects non-numeric core', () => {
    expect(parseSemver('1.x.3')).toBeUndefined();
  });

  test('rejects empty', () => {
    expect(parseSemver('')).toBeUndefined();
  });
});

describe('compareSemver', () => {
  test('numeric ordering', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  test('pre-release ranks below release', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
  });

  test('pre-release ordering', () => {
    expect(compareSemver('1.0.0-alpha', ' 1.0.0-alpha.1'.trim())).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha.beta', '1.0.0-beta')).toBeLessThan(0);
    expect(compareSemver('1.0.0-beta', '1.0.0-beta.2')).toBeLessThan(0);
    expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.11')).toBeLessThan(0);
    expect(compareSemver('1.0.0-beta.11', '1.0.0-rc.1')).toBeLessThan(0);
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
  });

  test('build metadata is ignored', () => {
    expect(compareSemver('1.0.0+a', '1.0.0+z')).toBe(0);
  });

  test('non-semver compares lexically and below semver', () => {
    expect(compareSemver('not-semver-A', 'not-semver-B')).toBeLessThan(0);
    expect(compareSemver('1.0.0', 'not-semver')).toBeGreaterThan(0);
    expect(compareSemver('not-semver', '1.0.0')).toBeLessThan(0);
  });
});
