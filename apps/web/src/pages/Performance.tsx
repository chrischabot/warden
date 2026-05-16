import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { LineChart } from '../components/LineChart';
import { Sparkline } from '../components/Sparkline';
import { Stat } from '../components/Stat';
import { Table, type TableColumn } from '../components/Table';
import { MOCK_TRANSACTIONS } from '../data/mock';
import { noisySeries, timeLabels } from '../data/series';
import { MOCK_TRACES } from '../data/traces';
import type { TransactionView } from '../data/types';
import { useApp } from '../state/AppContext';

type PerfSort = 'p95' | 'p99' | 'throughputPerMin' | 'failureRate' | 'apdex';

export function Performance(): JSX.Element {
  const ctx = useApp();
  const navigate = useNavigate();
  const [op, setOp] = useState<'all' | 'http.server' | 'queue.process'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<PerfSort>('p95');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo(() => {
    let out = [...MOCK_TRANSACTIONS];
    if (op !== 'all') out = out.filter((t) => t.op === op);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((t) => t.name.toLowerCase().includes(q));
    }
    out.sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return out;
  }, [op, search, sort, sortDir]);

  const length = ctx.timeRange === '1h' ? 30 : 24;
  const charts = useMemo(
    () => ({
      tpm: noisySeries(11, length, 1900, 280, 5),
      p95: noisySeries(12, length, 230, 50, -1),
      labels: timeLabels(ctx.timeRange, length),
    }),
    [ctx.timeRange, length],
  );

  const aggregate = aggregate24h(rows);

  const columns: readonly TableColumn<TransactionView>[] = [
    {
      key: 'name',
      header: 'Transaction',
      render: (row) => (
        <div>
          <div className="font-medium">{row.name}</div>
          <div className="mt-0.5 text-xs text-sr-muted">{row.op}</div>
        </div>
      ),
    },
    {
      key: 'graph',
      header: 'Trend',
      render: (row) => (
        <div className="text-sr-accent">
          <Sparkline
            data={noisySeries(row.id.charCodeAt(0), 18, row.p95, row.p95 * 0.4)}
            width={70}
            height={22}
            stroke="currentColor"
            ariaLabel={`${row.name} trend`}
          />
        </div>
      ),
      width: '90px',
    },
    { key: 'p50', header: 'p50', align: 'right', render: (r) => <span className="tabular-nums">{r.p50}ms</span>, width: '70px' },
    { key: 'p95', header: 'p95', align: 'right', render: (r) => <span className="tabular-nums">{r.p95}ms</span>, width: '70px' },
    { key: 'p99', header: 'p99', align: 'right', render: (r) => <span className="tabular-nums">{r.p99}ms</span>, width: '80px' },
    { key: 'tpm', header: 'Throughput', align: 'right', render: (r) => <span className="tabular-nums">{r.throughputPerMin}/min</span>, width: '120px' },
    {
      key: 'failure',
      header: 'Failure rate',
      align: 'right',
      render: (r) => (
        <Badge tone={r.failureRate > 0.02 ? 'error' : r.failureRate > 0.01 ? 'warning' : 'success'}>
          {(r.failureRate * 100).toFixed(2)}%
        </Badge>
      ),
      width: '120px',
    },
    { key: 'apdex', header: 'Apdex', align: 'right', render: (r) => <span className={r.apdex < 0.8 ? 'text-sr-warning' : 'text-sr-fg'}>{r.apdex.toFixed(2)}</span>, width: '70px' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Performance</h1>
        <p className="mt-1 text-sm text-sr-muted">
          {ctx.environment === 'all' ? 'all envs' : ctx.environment} · {ctx.timeRange} · {rows.length} transactions
        </p>
      </header>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Throughput" value={`${aggregate.tpm.toLocaleString()} / min`} />
        <Stat label="Avg p95" value={`${aggregate.p95}ms`} />
        <Stat label="Apdex" value={aggregate.apdex.toFixed(2)} tone={aggregate.apdex < 0.8 ? 'warning' : 'success'} />
        <Stat
          label="Failure rate"
          value={`${(aggregate.failureRate * 100).toFixed(2)}%`}
          tone={aggregate.failureRate > 0.01 ? 'warning' : 'success'}
        />
      </div>

      <Card title="Throughput + p95 over time">
        <LineChart
          series={[
            { name: 'tpm', color: '#7c5cff', data: charts.tpm },
            { name: 'p95 (ms)', color: '#4ade80', data: charts.p95 },
          ]}
          xLabels={charts.labels}
          ariaLabel="performance chart"
        />
      </Card>

      <Card title="Transactions">
        <div className="flex flex-wrap items-center gap-2 border-b border-sr-border/60 pb-3">
          <input
            type="search"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="search transactions"
            data-testid="perf-search"
            className="min-w-[240px] flex-1 rounded-md border border-sr-border bg-sr-bg px-3 py-1.5 text-sm placeholder:text-sr-muted focus:border-sr-accent focus:outline-none"
          />
          <div className="flex items-center gap-1">
            {(['all', 'http.server', 'queue.process'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOp(o)}
                aria-pressed={op === o}
                data-testid={`op-${o}`}
                className={[
                  'rounded border px-2 py-0.5 text-xs',
                  op === o
                    ? 'border-sr-accent bg-sr-accent/15 text-sr-accent'
                    : 'border-sr-border bg-sr-bg text-sr-muted hover:text-sr-fg',
                ].join(' ')}
              >
                {o}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs">
            <span className="text-sr-muted">sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as PerfSort)}
              aria-label="sort"
              data-testid="perf-sort"
              className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
            >
              <option value="p95">p95</option>
              <option value="p99">p99</option>
              <option value="throughputPerMin">Throughput</option>
              <option value="failureRate">Failure rate</option>
              <option value="apdex">Apdex</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              aria-label={`sort dir ${sortDir}`}
              data-testid="perf-sort-dir"
              className="rounded border border-sr-border px-1.5 py-0.5 text-xs hover:bg-white/5"
            >
              {sortDir === 'desc' ? '↓' : '↑'}
            </button>
          </label>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon="↘"
            title="No transactions match"
            body="Adjust your op chip, search, or time range to see results."
            testId="perf-empty"
          />
        ) : (
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r: TransactionView) => {
              const sample = MOCK_TRACES.find((t) => t.rootTransaction === r.name) ?? MOCK_TRACES[0];
              if (sample) navigate(`/traces/${sample.id}`);
            }}
            emptyMessage="No transactions match."
          />
        )}
      </Card>
    </div>
  );
}

function aggregate24h(txs: readonly TransactionView[]): {
  readonly tpm: number;
  readonly p95: number;
  readonly apdex: number;
  readonly failureRate: number;
} {
  if (txs.length === 0) return { tpm: 0, p95: 0, apdex: 1, failureRate: 0 };
  const tpm = txs.reduce((s, t) => s + t.throughputPerMin, 0);
  const p95 = Math.round(txs.reduce((s, t) => s + t.p95, 0) / txs.length);
  const apdex = txs.reduce((s, t) => s + t.apdex, 0) / txs.length;
  const failureRate = txs.reduce((s, t) => s + t.failureRate, 0) / txs.length;
  return { tpm, p95, apdex, failureRate };
}