import { EmptyState } from '../components/EmptyState';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Checkbox } from '../components/Checkbox';
import { Sparkline } from '../components/Sparkline';
import { Table, type TableColumn } from '../components/Table';
import { MOCK_ISSUES } from '../data/mock';
import { noisySeries } from '../data/series';
import type { IssueLevel, IssueStatus, IssueView } from '../data/types';
import { useApp } from '../state/AppContext';

type SortKey = 'lastSeen' | 'eventsCount' | 'usersAffected';

const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  lastSeen: 'Last seen',
  eventsCount: 'Events',
  usersAffected: 'Users',
};

export function IssuesList(): JSX.Element {
  const ctx = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<IssueStatus | 'all'>('unresolved');
  const [level, setLevel] = useState<IssueLevel | 'all'>('all');
  const [project, setProject] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('lastSeen');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(() => {
    let out = MOCK_ISSUES.filter((i) => (filter === 'all' ? true : i.status === filter));
    if (level !== 'all') out = out.filter((i) => i.level === level);
    if (project !== 'all') out = out.filter((i) => i.project === project);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.shortId.toLowerCase().includes(q) ||
          i.culprit.toLowerCase().includes(q),
      );
    }
    const sorted = [...out].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      // dates as strings — lexical compare works for ISO timestamps
      const as = String(av);
      const bs = String(bv);
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return sorted;
  }, [filter, level, project, search, sort, sortDir]);

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll(check: boolean): void {
    setSelected(check ? new Set(rows.map((r) => r.id)) : new Set());
  }
  function bulkAction(action: 'resolve' | 'ignore' | 'archive'): void {
    const count = selected.size;
    if (count === 0) return;
    ctx.pushToast({
      tone: 'success',
      title: `${action.charAt(0).toUpperCase()}${action.slice(1)}d ${count} issue${count > 1 ? 's' : ''}`,
    });
    setSelected(new Set());
  }

  const columns: readonly TableColumn<IssueView>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          aria-label="select all issues"
          checked={selected.size > 0 && selected.size === rows.length}
          onChange={(e) => selectAll(e.target.checked)}
        />
      ),
      render: (row) => (
        <Checkbox
          aria-label={`select ${row.shortId}`}
          checked={selected.has(row.id)}
          onChange={(e) => {
            e.stopPropagation();
            toggleSelect(row.id);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      width: '36px',
    },
    {
      key: 'title',
      header: 'Issue',
      render: (row) => (
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={levelTone(row.level)}>{row.level}</Badge>
            <span className="font-medium">{row.title}</span>
            {row.isUnhandled && (
              <span className="rounded border border-sr-error/40 px-1.5 text-[10px] uppercase text-sr-error">unhandled</span>
            )}
          </div>
          <div className="mt-1 text-xs text-sr-muted">
            {row.shortId} · {row.culprit}
          </div>
        </div>
      ),
    },
    {
      key: 'graph',
      header: 'Trend',
      render: (row) => (
        <div className="text-sr-accent">
          <Sparkline
            data={noisySeries(row.id.charCodeAt(0) + row.id.length, 24, 12, 8)}
            width={80}
            height={24}
            stroke="currentColor"
            ariaLabel={`${row.shortId} trend`}
          />
        </div>
      ),
      width: '90px',
    },
    { key: 'project', header: 'Project', render: (row) => <Badge tone="accent">{row.project}</Badge>, width: '110px' },
    {
      key: 'events',
      header: 'Events',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.eventsCount.toLocaleString()}</span>,
      width: '110px',
    },
    {
      key: 'users',
      header: 'Users',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.usersAffected}</span>,
      width: '90px',
    },
    {
      key: 'last',
      header: 'Last seen',
      align: 'right',
      render: (row) => <span className="text-sr-muted">{relativeTime(row.lastSeen)}</span>,
      width: '140px',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Issues</h1>
          <p className="mt-1 text-sm text-sr-muted">
            {rows.length} {filter === 'all' ? 'total' : filter} · {ctx.environment === 'all' ? 'all envs' : ctx.environment}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={filter === 'all' ? 'primary' : 'ghost'} onClick={() => setFilter('all')}>All</Button>
          <Button variant={filter === 'unresolved' ? 'primary' : 'ghost'} onClick={() => setFilter('unresolved')}>Unresolved</Button>
          <Button variant={filter === 'resolved' ? 'primary' : 'ghost'} onClick={() => setFilter('resolved')}>Resolved</Button>
          <Button variant={filter === 'ignored' ? 'primary' : 'ghost'} onClick={() => setFilter('ignored')}>Ignored</Button>
        </div>
      </header>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-sr-border/60 pb-3">
          <input
            type="search"
            placeholder="Search issues, short id, culprit..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="search issues"
            data-testid="issues-search"
            className="min-w-[280px] flex-1 rounded-md border border-sr-border bg-sr-bg px-3 py-1.5 text-sm placeholder:text-sr-muted focus:border-sr-accent focus:outline-none"
          />
          <label className="flex items-center gap-2 text-xs">
            <span className="text-sr-muted">level:</span>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as IssueLevel | 'all')}
              aria-label="filter level"
              data-testid="filter-level"
              className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
            >
              <option value="all">all</option>
              <option value="fatal">fatal</option>
              <option value="error">error</option>
              <option value="warning">warning</option>
              <option value="info">info</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-sr-muted">project:</span>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              aria-label="filter project"
              data-testid="filter-project"
              className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
            >
              <option value="all">all</option>
              <option value="web">web</option>
              <option value="api">api</option>
              <option value="worker">worker</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-sr-muted">sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="sort by"
              data-testid="sort-key"
              className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
            >
              {(['lastSeen', 'eventsCount', 'usersAffected'] as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              aria-label={`sort direction ${sortDir}`}
              data-testid="sort-dir"
              className="rounded border border-sr-border px-1.5 py-0.5 text-xs hover:bg-white/5"
            >
              {sortDir === 'desc' ? '↓' : '↑'}
            </button>
          </label>
        </div>

        {selected.size > 0 && (
          <div
            data-testid="bulk-actions"
            className="flex items-center justify-between border-b border-sr-accent/30 bg-sr-accent/10 px-3 py-2 text-sm"
          >
            <span>{selected.size} selected</span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => bulkAction('resolve')} data-testid="bulk-resolve">
                Resolve
              </Button>
              <Button variant="secondary" onClick={() => bulkAction('ignore')} data-testid="bulk-ignore">
                Ignore
              </Button>
              <Button variant="secondary" onClick={() => bulkAction('archive')} data-testid="bulk-archive">
                Archive
              </Button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon="○"
            title="No issues match the current filters"
            body="Try widening the search, switching the level/project filter, or clearing the search box."
            testId="issues-empty"
          />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/issues/${r.id}`)}
            emptyMessage={`No issues match the current filters.`}
          />
        )}
      </Card>
    </div>
  );
}

function levelTone(level: IssueView['level']): 'fatal' | 'error' | 'warning' | 'accent' | 'neutral' {
  switch (level) {
    case 'fatal': return 'fatal';
    case 'error': return 'error';
    case 'warning': return 'warning';
    case 'info': return 'accent';
    case 'debug': return 'neutral';
  }
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const diff = now.getTime() - t;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}