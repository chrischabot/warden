import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LineChart } from '../components/LineChart';
import { Modal } from '../components/Modal';
import { Table, type TableColumn } from '../components/Table';
import { noisySeries, timeLabels } from '../data/series';
import { useApp } from '../state/AppContext';

interface FilterClause {
  readonly key: string;
  readonly op: '=' | '!=' | 'contains' | '>' | '<';
  readonly value: string;
}

const FIELDS = ['timestamp', 'message', 'level', 'environment', 'release', 'user.id', 'transaction', 'http.status_code'];
const AGGREGATES = ['count', 'count_unique(user)', 'p50(duration)', 'p95(duration)', 'p99(duration)', 'failure_rate'];

export function Discover(): JSX.Element {
  const ctx = useApp();
  const [selectedAggregates, setSelectedAggregates] = useState<string[]>(['count', 'p95(duration)']);
  const [groupBy, setGroupBy] = useState<string>('transaction');
  const [filters, setFilters] = useState<FilterClause[]>([
    { key: 'level', op: '=', value: 'error' },
  ]);
  const [queryText, setQueryText] = useState('level:error environment:production');
  const [results, setResults] = useState<DiscoverResult[]>([...MOCK_RESULTS]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedName, setSavedName] = useState('');

  const chartData = useMemo(() => {
    const length = ctx.timeRange === '1h' ? 30 : ctx.timeRange === '24h' ? 24 : 30;
    return {
      labels: timeLabels(ctx.timeRange, length),
      series: [
        { name: 'count', color: '#7c5cff', data: noisySeries(1, length, 800, 200, 5) },
        { name: 'p95(duration)', color: '#4ade80', data: noisySeries(2, length, 280, 80, -1) },
      ],
    };
  }, [ctx.timeRange]);

  function addFilter(): void {
    setFilters([...filters, { key: 'environment', op: '=', value: 'production' }]);
  }
  function removeFilter(i: number): void {
    setFilters(filters.filter((_, idx) => idx !== i));
  }
  function runQuery(): void {
    setResults([...MOCK_RESULTS]);
    ctx.pushToast({ tone: 'success', title: 'Query executed', body: `${MOCK_RESULTS.length} rows returned` });
  }
  function saveQuery(): void {
    if (savedName.trim().length === 0) {
      ctx.pushToast({ tone: 'warning', title: 'Name required' });
      return;
    }
    setSaveOpen(false);
    ctx.pushToast({ tone: 'success', title: `Saved query "${savedName}"` });
    setSavedName('');
  }

  function toggleAggregate(name: string): void {
    if (selectedAggregates.includes(name)) {
      setSelectedAggregates(selectedAggregates.filter((a) => a !== name));
    } else {
      setSelectedAggregates([...selectedAggregates, name]);
    }
  }

  const columns: readonly TableColumn<DiscoverResult>[] = [
    {
      key: 'group',
      header: groupBy,
      render: (r) => <span className="font-mono text-xs">{r.group}</span>,
    },
    { key: 'count', header: 'count', align: 'right', render: (r) => <span className="tabular-nums">{r.count.toLocaleString()}</span> },
    { key: 'p95', header: 'p95', align: 'right', render: (r) => <span className="tabular-nums">{r.p95}ms</span> },
    { key: 'p99', header: 'p99', align: 'right', render: (r) => <span className="tabular-nums">{r.p99}ms</span> },
    { key: 'failure', header: 'failure rate', align: 'right', render: (r) => (
        <Badge tone={r.failureRate > 0.05 ? 'error' : r.failureRate > 0.01 ? 'warning' : 'success'}>
          {(r.failureRate * 100).toFixed(2)}%
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Discover</h1>
          <p className="mt-1 text-sm text-sr-muted">Ad-hoc queries over your event data.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setSaveOpen(true)} data-testid="save-query">
            Save query
          </Button>
          <Button variant="primary" onClick={runQuery} data-testid="run-query">
            Run query
          </Button>
        </div>
      </header>

      <Card title="Query">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-sr-muted">
            <span>Search</span>
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="level:error environment:production"
              aria-label="discover query"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm text-sr-fg focus:border-sr-accent focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-sr-muted">Aggregates:</span>
            {AGGREGATES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => toggleAggregate(a)}
                aria-pressed={selectedAggregates.includes(a)}
                className={[
                  'rounded border px-2 py-0.5 text-xs',
                  selectedAggregates.includes(a)
                    ? 'border-sr-accent bg-sr-accent/15 text-sr-accent'
                    : 'border-sr-border bg-sr-bg text-sr-muted hover:text-sr-fg',
                ].join(' ')}
              >
                {a}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-sr-muted">Group by:</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              aria-label="group by"
              className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-sm text-sr-fg focus:border-sr-accent focus:outline-none"
            >
              {FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-sr-muted">Filters</span>
              <Button variant="ghost" onClick={addFilter} data-testid="add-filter">
                + Add filter
              </Button>
            </div>
            {filters.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-sr-border bg-sr-bg/40 px-2 py-1.5">
                <select
                  value={f.key}
                  onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  aria-label={`filter-${i}-field`}
                  className="rounded border border-sr-border bg-sr-bg px-1.5 py-0.5 text-xs text-sr-fg"
                >
                  {FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
                <select
                  value={f.op}
                  onChange={(e) =>
                    setFilters(filters.map((x, j) => (j === i ? { ...x, op: e.target.value as FilterClause['op'] } : x)))
                  }
                  aria-label={`filter-${i}-op`}
                  className="rounded border border-sr-border bg-sr-bg px-1.5 py-0.5 text-xs text-sr-fg"
                >
                  <option value="=">=</option>
                  <option value="!=">!=</option>
                  <option value="contains">contains</option>
                  <option value=">">&gt;</option>
                  <option value="<">&lt;</option>
                </select>
                <input
                  type="text"
                  value={f.value}
                  onChange={(e) => setFilters(filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  aria-label={`filter-${i}-value`}
                  className="flex-1 rounded border border-sr-border bg-sr-bg px-2 py-0.5 text-xs text-sr-fg"
                />
                <button
                  type="button"
                  aria-label={`remove filter ${i}`}
                  onClick={() => removeFilter(i)}
                  className="text-sr-muted hover:text-sr-error"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Time series">
        <LineChart series={chartData.series} xLabels={chartData.labels} ariaLabel="discover chart" />
      </Card>

      <Card title={`Results (${results.length})`}>
        <Table columns={columns} rows={results} rowKey={(r) => r.group} />
      </Card>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save query"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveQuery} data-testid="save-query-confirm">
              Save
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1 text-sm">
          <span>Name</span>
          <input
            type="text"
            value={savedName}
            onChange={(e) => setSavedName(e.target.value)}
            placeholder="Top error transactions"
            aria-label="saved query name"
            className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            autoFocus
          />
        </label>
      </Modal>
    </div>
  );
}

interface DiscoverResult {
  readonly group: string;
  readonly count: number;
  readonly p95: number;
  readonly p99: number;
  readonly failureRate: number;
}

const MOCK_RESULTS: readonly DiscoverResult[] = [
  { group: 'GET /api/users', count: 28400, p95: 42, p99: 81, failureRate: 0.004 },
  { group: 'POST /api/orders', count: 12320, p95: 312, p99: 1980, failureRate: 0.018 },
  { group: 'GET /api/feed', count: 51200, p95: 145, p99: 380, failureRate: 0.001 },
  { group: 'POST /api/checkout', count: 4180, p95: 540, p99: 2200, failureRate: 0.061 },
  { group: 'sync.shippingProvider', count: 720, p95: 2800, p99: 6800, failureRate: 0.04 },
];