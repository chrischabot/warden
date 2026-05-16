import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Table, type TableColumn } from '../components/Table';
import { MOCK_TRACES, type TraceSummary } from '../data/traces';
import { useApp } from '../state/AppContext';

export function TraceExplorer(): JSX.Element {
  const ctx = useApp();
  const navigate = useNavigate();
  const [project, setProject] = useState<'all' | string>('all');
  const [status, setStatus] = useState<'all' | 'ok' | 'error'>('all');
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    let out = [...MOCK_TRACES];
    if (project !== 'all') out = out.filter((t) => t.project === project);
    if (status !== 'all') out = out.filter((t) => t.status === status);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((t) => t.rootTransaction.toLowerCase().includes(q) || t.id.includes(q));
    }
    return out;
  }, [project, status, search]);

  const columns: readonly TableColumn<TraceSummary>[] = [
    {
      key: 'trace',
      header: 'Trace',
      render: (r) => (
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={r.status === 'error' ? 'error' : 'success'}>{r.status}</Badge>
            <span className="font-medium">{r.rootTransaction}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-sr-muted">
            <span className="font-mono">{r.id}</span>
            <span>·</span>
            <span>{r.op}</span>
            {r.httpStatus && (
              <>
                <span>·</span>
                <span>{r.httpStatus}</span>
              </>
            )}
          </div>
        </div>
      ),
    },
    { key: 'project', header: 'Project', render: (r) => <Badge tone="accent">{r.project}</Badge>, width: '110px' },
    { key: 'spans', header: 'Spans', align: 'right', render: (r) => <span className="tabular-nums">{r.spanCount}</span>, width: '80px' },
    {
      key: 'duration',
      header: 'Duration',
      align: 'right',
      render: (r) => (
        <span className={[
          'tabular-nums',
          r.durationMs > 1000 ? 'text-sr-warning' : 'text-sr-fg',
        ].join(' ')}>
          {r.durationMs.toLocaleString()}ms
        </span>
      ),
      width: '110px',
    },
    {
      key: 'user',
      header: 'User',
      render: (r) => <span className="text-xs text-sr-muted">{r.user ?? '—'}</span>,
      width: '90px',
    },
    {
      key: 'time',
      header: 'Started',
      align: 'right',
      render: (r) => <span className="text-xs text-sr-muted">{r.startedAt.split('T')[1]?.slice(0, 8)}</span>,
      width: '100px',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Traces</h1>
        <p className="mt-1 text-sm text-sr-muted">
          {ctx.environment === 'all' ? 'all envs' : ctx.environment} · {ctx.timeRange} · {rows.length} trace(s)
        </p>
      </header>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-sr-border/60 pb-3">
          <input
            type="search"
            placeholder="Search by transaction or trace id..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="search traces"
            data-testid="trace-search"
            className="min-w-[240px] flex-1 rounded-md border border-sr-border bg-sr-bg px-3 py-1.5 text-sm placeholder:text-sr-muted focus:border-sr-accent focus:outline-none"
          />
          <label className="flex items-center gap-2 text-xs">
            <span className="text-sr-muted">project:</span>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              aria-label="filter project"
              data-testid="trace-project"
              className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
            >
              <option value="all">all</option>
              <option value="api">api</option>
              <option value="web">web</option>
              <option value="worker">worker</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-sr-muted">status:</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'all' | 'ok' | 'error')}
              aria-label="filter status"
              data-testid="trace-status"
              className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
            >
              <option value="all">all</option>
              <option value="ok">ok</option>
              <option value="error">error</option>
            </select>
          </label>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="≡"
            title="No traces match your filters"
            body="Try widening the time range, switching environments, or clearing the search."
            testId="traces-empty"
          />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/traces/${r.id}`)}
          />
        )}
      </Card>
    </div>
  );
}