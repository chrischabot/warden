import { describe, expect, test } from 'bun:test';
import { orgCan, orgRoleAtLeast, teamCan } from '../src/permissions';

describe('orgCan', () => {
  test('owner can do everything', () => {
    for (const perm of ['org:delete', 'billing:write', 'team:write', 'project:delete'] as const) {
      expect(orgCan('owner', perm)).toBe(true);
    }
  });

  test('manager cannot delete the org or transfer ownership', () => {
    expect(orgCan('manager', 'org:delete')).toBe(false);
    expect(orgCan('manager', 'org:transfer')).toBe(false);
    expect(orgCan('manager', 'team:write')).toBe(true);
  });

  test('admin can manage members + projects but not teams', () => {
    expect(orgCan('admin', 'member:invite')).toBe(true);
    expect(orgCan('admin', 'project:write')).toBe(true);
    expect(orgCan('admin', 'team:write')).toBe(false);
    expect(orgCan('admin', 'project:delete')).toBe(false);
  });

  test('member is read-only', () => {
    expect(orgCan('member', 'project:read')).toBe(true);
    expect(orgCan('member', 'project:write')).toBe(false);
    expect(orgCan('member', 'member:invite')).toBe(false);
  });

  test('billing can do billing things only', () => {
    expect(orgCan('billing', 'billing:read')).toBe(true);
    expect(orgCan('billing', 'billing:write')).toBe(true);
    expect(orgCan('billing', 'project:read')).toBe(false);
  });
});

describe('teamCan', () => {
  test('team admin manages team', () => {
    expect(teamCan('admin', 'team:manage')).toBe(true);
    expect(teamCan('admin', 'team:project-assign')).toBe(true);
  });

  test('team member reads + writes events', () => {
    expect(teamCan('member', 'event:read')).toBe(true);
    expect(teamCan('member', 'event:write')).toBe(true);
    expect(teamCan('member', 'team:manage')).toBe(false);
  });
});

describe('orgRoleAtLeast', () => {
  test('owner ≥ everyone', () => {
    for (const r of ['owner', 'manager', 'admin', 'member', 'billing'] as const) {
      expect(orgRoleAtLeast('owner', r)).toBe(true);
    }
  });

  test('strict ordering matches docs', () => {
    expect(orgRoleAtLeast('manager', 'admin')).toBe(true);
    expect(orgRoleAtLeast('admin', 'member')).toBe(true);
    expect(orgRoleAtLeast('member', 'admin')).toBe(false);
    expect(orgRoleAtLeast('billing', 'member')).toBe(false);
  });
});
