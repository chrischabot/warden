import type { JSX } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { Tabs } from '../components/Tabs';
import { Table, type TableColumn } from '../components/Table';
import { useApp } from '../state/AppContext';

type SettingsTab = 'org' | 'members' | 'teams' | 'tokens' | 'projects' | 'integrations' | 'audit' | 'danger';

interface Member {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: 'owner' | 'manager' | 'admin' | 'member' | 'billing';
}

const SEED_MEMBERS: readonly Member[] = [
  { id: '1', name: 'Alice Owner', email: 'alice@acme.com', role: 'owner' },
  { id: '2', name: 'Bob Manager', email: 'bob@acme.com', role: 'manager' },
  { id: '3', name: 'Carol Admin', email: 'carol@acme.com', role: 'admin' },
  { id: '4', name: 'Dan Member', email: 'dan@acme.com', role: 'member' },
];

const SEED_TOKENS = [
  { id: 't1', label: 'CI deploy', scopes: ['project:write', 'event:write'], lastUsed: '2 hours ago' },
  { id: 't2', label: 'Sourcemaps upload', scopes: ['project:write'], lastUsed: 'yesterday' },
];

const SEED_INTEGRATIONS = [
  { id: 'slack', name: 'Slack', enabled: true, description: 'Send alerts to Slack channels' },
  { id: 'github', name: 'GitHub', enabled: true, description: 'Link commits and create issues' },
  { id: 'jira', name: 'Jira', enabled: false, description: 'Auto-create Jira tickets' },
  { id: 'pagerduty', name: 'PagerDuty', enabled: true, description: 'Route critical alerts to oncall' },
  { id: 'opsgenie', name: 'OpsGenie', enabled: false, description: 'Alternative oncall routing' },
];

const SEED_AUDIT = [
  { ts: '11:55:01', who: 'alice', action: 'rotated client key', target: 'project:web' },
  { ts: '11:30:12', who: 'bob', action: 'invited', target: 'dan@acme.com' },
  { ts: '10:08:33', who: 'system', action: 'auto-archived', target: '14 issues' },
  { ts: '09:50:01', who: 'carol', action: 'updated rate limits', target: 'project:api' },
  { ts: 'yesterday', who: 'alice', action: 'created alert', target: 'High error rate (web)' },
];

const PROJECTS = [
  { slug: 'web', platform: 'javascript', events24h: 412_000 },
  { slug: 'api', platform: 'node', events24h: 188_400 },
  { slug: 'worker', platform: 'python', events24h: 28_100 },
  { slug: 'ios', platform: 'swift', events24h: 14_800 },
  { slug: 'android', platform: 'kotlin', events24h: 22_400 },
];

export function Settings(): JSX.Element {
  const ctx = useApp();
  const [tab, setTab] = useState<SettingsTab>('org');
  const [members, setMembers] = useState<Member[]>([...SEED_MEMBERS]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Member['role']>('member');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [orgName, setOrgName] = useState('acme');
  const [orgSlug, setOrgSlug] = useState('acme');
  const [auditFilter, setAuditFilter] = useState('');

  function inviteMember(): void {
    if (!inviteEmail.trim()) {
      ctx.pushToast({ tone: 'warning', title: 'Email required' });
      return;
    }
    const id = `m${members.length + 1}_${Date.now().toString(36).slice(-3)}`;
    const m: Member = { id, name: inviteEmail.split('@')[0] ?? 'New member', email: inviteEmail.trim(), role: inviteRole };
    setMembers([...members, m]);
    setInviteOpen(false);
    setInviteEmail('');
    ctx.pushToast({ tone: 'success', title: `Invited ${m.email}` });
  }
  function changeRole(id: string, role: Member['role']): void {
    setMembers(members.map((m) => (m.id === id ? { ...m, role } : m)));
    ctx.pushToast({ tone: 'info', title: `Role updated → ${role}` });
  }
  function saveOrg(): void {
    ctx.pushToast({ tone: 'success', title: 'Organisation saved' });
  }
  function deleteOrg(): void {
    setDeleteOpen(false);
    ctx.pushToast({ tone: 'error', title: 'Demo: delete blocked' });
  }

  const memberCols: readonly TableColumn<Member>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (m) => (
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sr-accent/15 text-xs uppercase text-sr-accent">
            {m.name.charAt(0)}
          </span>
          <div>
            <div className="font-medium">{m.name}</div>
            <div className="text-xs text-sr-muted">{m.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      width: '180px',
      render: (m) => (
        <select
          value={m.role}
          onChange={(e) => changeRole(m.id, e.target.value as Member['role'])}
          aria-label={`role for ${m.email}`}
          data-testid={`role-${m.id}`}
          className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
        >
          {(['owner', 'manager', 'admin', 'member', 'billing'] as const).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-sr-muted">Organisation · acme</p>
      </header>

      <Tabs
        activeId={tab}
        onChange={(id) => setTab(id as SettingsTab)}
        items={[
          { id: 'org', label: 'General' },
          { id: 'members', label: 'Members', badge: members.length },
          { id: 'teams', label: 'Teams' },
          { id: 'tokens', label: 'API Tokens', badge: SEED_TOKENS.length },
          { id: 'projects', label: 'Projects', badge: PROJECTS.length },
          { id: 'integrations', label: 'Integrations' },
          { id: 'audit', label: 'Audit Log' },
          { id: 'danger', label: 'Danger Zone' },
        ]}
        ariaLabel="settings tabs"
      />

      {tab === 'org' && (
        <Card title="Organisation">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span>Name</span>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                aria-label="org name"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Slug</span>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                aria-label="org slug"
                className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm focus:border-sr-accent focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={saveOrg} data-testid="save-org">
              Save
            </Button>
          </div>
        </Card>
      )}

      {tab === 'members' && (
        <Card
          title="Members"
          action={
            <Button variant="primary" onClick={() => setInviteOpen(true)} data-testid="invite-member">
              Invite member
            </Button>
          }
        >
          <Table columns={memberCols} rows={members} rowKey={(m) => m.id} />
        </Card>
      )}

      {tab === 'teams' && (
        <Card title="Teams">
          <ul className="flex flex-col gap-2 text-sm">
            {['platform', 'frontend', 'mobile', 'data'].map((t) => (
              <li key={t} className="flex items-center justify-between rounded border border-sr-border/60 px-3 py-2">
                <Badge tone="accent">#{t}</Badge>
                <span className="text-xs text-sr-muted">{1 + (t.length % 4)} member(s)</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'tokens' && (
        <Card title="API tokens" action={<Button variant="primary">New token</Button>}>
          <ul className="flex flex-col gap-2 text-sm">
            {SEED_TOKENS.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded border border-sr-border/60 px-3 py-2">
                <div>
                  <div className="font-medium">{t.label}</div>
                  <div className="mt-0.5 flex gap-1 text-xs">
                    {t.scopes.map((s) => (
                      <Badge key={s} tone="neutral">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-sr-muted">Last used {t.lastUsed}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'projects' && (
        <Card title="Projects">
          <ul className="flex flex-col gap-2 text-sm">
            {PROJECTS.map((p) => (
              <li
                key={p.slug}
                className="flex items-center justify-between rounded border border-sr-border/60 px-3 py-2 hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-3">
                  <Badge tone="accent">{p.slug}</Badge>
                  <span className="text-xs text-sr-muted">{p.platform}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-sr-muted">
                  <span className="tabular-nums">{p.events24h.toLocaleString()} events / 24h</span>
                  <Link to={`/settings/projects/${p.slug}`} className="text-sr-accent hover:underline" data-testid={`project-${p.slug}`}>
                    Configure →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'integrations' && (
        <Card title="Integrations">
          <ul className="flex flex-col gap-2 text-sm">
            {SEED_INTEGRATIONS.map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded border border-sr-border/60 px-3 py-2">
                <div>
                  <div className="font-medium">{i.name}</div>
                  <div className="mt-0.5 text-xs text-sr-muted">{i.description}</div>
                </div>
                <Badge tone={i.enabled ? 'success' : 'neutral'}>{i.enabled ? 'enabled' : 'disabled'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'audit' && (
        <Card
          title="Audit log"
          action={
            <input
              type="search"
              placeholder="Filter actions..."
              value={auditFilter}
              onChange={(e) => setAuditFilter(e.target.value)}
              aria-label="filter audit log"
              data-testid="audit-filter"
              className="w-44 rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
            />
          }
        >
          <ul className="flex flex-col gap-1.5 font-mono text-xs">
            {SEED_AUDIT
              .filter((a) => {
                if (!auditFilter.trim()) return true;
                const q = auditFilter.toLowerCase();
                return (
                  a.who.toLowerCase().includes(q) || a.action.toLowerCase().includes(q) || a.target.toLowerCase().includes(q)
                );
              })
              .map((a, i) => (
                <li key={i} className="flex items-center gap-3 rounded border border-sr-border/50 px-3 py-1.5">
                  <span className="w-20 text-sr-muted">{a.ts}</span>
                  <Badge tone="accent">{a.who}</Badge>
                  <span>{a.action}</span>
                  <span className="text-sr-muted">→</span>
                  <span>{a.target}</span>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {tab === 'danger' && (
        <Card title="Danger zone">
          <p className="text-sm text-sr-muted">
            Deleting the organisation removes every project, issue, and event permanently. This cannot be undone.
          </p>
          <div className="mt-3">
            <Button variant="danger" onClick={() => setDeleteOpen(true)} data-testid="delete-org">
              Delete organisation
            </Button>
          </div>
        </Card>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={inviteMember} data-testid="invite-send">
              Send invite
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Email</span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@example.com"
              aria-label="invite email"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Role</span>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Member['role'])}
              aria-label="invite role"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            >
              {(['owner', 'manager', 'admin', 'member', 'billing'] as const).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete organisation?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteOrg} data-testid="delete-org-confirm">
              Delete forever
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Type the organisation slug to confirm. This action is destructive and irreversible.
        </p>
      </Modal>
    </div>
  );
}