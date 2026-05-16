import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LineChart } from '../components/LineChart';
import { Modal } from '../components/Modal';
import { Stat } from '../components/Stat';
import { noisySeries, spikySeries, timeLabels } from '../data/series';
import { useApp } from '../state/AppContext';

type WidgetType = 'line' | 'big_number' | 'table';

interface Widget {
  readonly id: string;
  readonly type: WidgetType;
  readonly title: string;
  readonly metric: string;
}

interface Dashboard {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly widgets: readonly Widget[];
}

const SEED: readonly Dashboard[] = [
  {
    id: 'd1',
    name: 'Web vitals overview',
    description: 'Frontend health for web app',
    widgets: [
      { id: 'w1', type: 'big_number', title: 'Apdex', metric: 'apdex(300)' },
      { id: 'w2', type: 'big_number', title: 'Throughput', metric: 'tpm()' },
      { id: 'w3', type: 'line', title: 'Errors / min', metric: 'count(level:error)' },
      { id: 'w4', type: 'line', title: 'p95 duration', metric: 'p95(duration)' },
    ],
  },
  {
    id: 'd2',
    name: 'Backend p95s',
    description: 'API latency snapshots per route',
    widgets: [
      { id: 'w5', type: 'line', title: 'p95 by route', metric: 'p95(duration) by route' },
      { id: 'w6', type: 'big_number', title: 'Failure rate', metric: 'failure_rate()' },
    ],
  },
];

export function Dashboards(): JSX.Element {
  const ctx = useApp();
  const [dashboards, setDashboards] = useState<Dashboard[]>([...SEED]);
  const [activeId, setActiveId] = useState<string>(SEED[0]?.id ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [newWidget, setNewWidget] = useState({ type: 'line' as WidgetType, title: '', metric: 'count()' });

  const active = dashboards.find((d) => d.id === activeId);

  function createDashboard(): void {
    const name = newDashboardName.trim();
    if (!name) {
      ctx.pushToast({ tone: 'warning', title: 'Name required' });
      return;
    }
    const id = `d${dashboards.length + 1}_${Date.now().toString(36).slice(-3)}`;
    const dash: Dashboard = { id, name, description: 'Untitled', widgets: [] };
    setDashboards([dash, ...dashboards]);
    setActiveId(id);
    setCreateOpen(false);
    setNewDashboardName('');
    ctx.pushToast({ tone: 'success', title: `Created dashboard "${name}"` });
  }

  function addWidget(): void {
    if (!active) return;
    if (!newWidget.title.trim()) {
      ctx.pushToast({ tone: 'warning', title: 'Widget title required' });
      return;
    }
    const widget: Widget = {
      id: `w_${Date.now().toString(36).slice(-5)}`,
      type: newWidget.type,
      title: newWidget.title.trim(),
      metric: newWidget.metric,
    };
    setDashboards(
      dashboards.map((d) =>
        d.id === active.id ? { ...d, widgets: [...d.widgets, widget] } : d,
      ),
    );
    setAddWidgetOpen(false);
    setNewWidget({ type: 'line', title: '', metric: 'count()' });
    ctx.pushToast({ tone: 'success', title: `Added widget "${widget.title}"` });
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboards</h1>
          <p className="mt-1 text-sm text-sr-muted">{dashboards.length} dashboard(s) saved</p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)} data-testid="new-dashboard">
          New dashboard
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        {dashboards.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setActiveId(d.id)}
            aria-pressed={d.id === activeId}
            data-testid={`dashboard-tab-${d.id}`}
            className={[
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              d.id === activeId
                ? 'border-sr-accent bg-sr-accent/15 text-sr-fg'
                : 'border-sr-border bg-sr-panel text-sr-muted hover:text-sr-fg',
            ].join(' ')}
          >
            {d.name}
          </button>
        ))}
      </div>

      {active && (
        <Card
          title={active.name}
          action={
            <Button variant="secondary" onClick={() => setAddWidgetOpen(true)} data-testid="add-widget">
              + Add widget
            </Button>
          }
        >
          <p className="mb-3 text-xs text-sr-muted">{active.description}</p>
          {active.widgets.length === 0 ? (
            <div className="rounded border border-dashed border-sr-border px-5 py-12 text-center text-sm text-sr-muted">
              No widgets yet. Click <span className="text-sr-fg">+ Add widget</span> to start.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {active.widgets.map((w) => (
                <WidgetView key={w.id} widget={w} />
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New dashboard"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createDashboard} data-testid="new-dashboard-confirm">
              Create
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1 text-sm">
          <span>Name</span>
          <input
            type="text"
            value={newDashboardName}
            onChange={(e) => setNewDashboardName(e.target.value)}
            placeholder="API performance"
            aria-label="dashboard name"
            className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            autoFocus
          />
        </label>
      </Modal>

      <Modal
        open={addWidgetOpen}
        onClose={() => setAddWidgetOpen(false)}
        title="Add widget"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddWidgetOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={addWidget} data-testid="add-widget-confirm">
              Add
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Title</span>
            <input
              type="text"
              value={newWidget.title}
              onChange={(e) => setNewWidget({ ...newWidget, title: e.target.value })}
              placeholder="Error rate by environment"
              aria-label="widget title"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Type</span>
            <select
              value={newWidget.type}
              onChange={(e) => setNewWidget({ ...newWidget, type: e.target.value as WidgetType })}
              aria-label="widget type"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            >
              <option value="line">Line chart</option>
              <option value="big_number">Big number</option>
              <option value="table">Table</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Metric</span>
            <input
              type="text"
              value={newWidget.metric}
              onChange={(e) => setNewWidget({ ...newWidget, metric: e.target.value })}
              aria-label="widget metric"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm focus:border-sr-accent focus:outline-none"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}

function WidgetView({ widget }: { widget: Widget }): JSX.Element {
  const ctx = useApp();
  const length = ctx.timeRange === '1h' ? 30 : ctx.timeRange === '24h' ? 24 : 30;
  const data = useMemo(() => {
    const seed = widget.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return widget.metric.includes('failure_rate')
      ? noisySeries(seed, length, 0.02, 0.01)
      : widget.metric.includes('p95')
      ? noisySeries(seed, length, 240, 60, -1)
      : widget.type === 'big_number'
      ? noisySeries(seed, 10, 95, 3)
      : spikySeries(seed, length, 80, 200);
  }, [widget.id, widget.metric, widget.type, length]);
  const labels = useMemo(() => timeLabels(ctx.timeRange, length), [ctx.timeRange, length]);

  switch (widget.type) {
    case 'big_number': {
      const v = data[data.length - 1] as number;
      return (
        <div className="rounded-lg border border-sr-border bg-sr-panel p-4">
          <Stat label={widget.title} value={fmtBig(v, widget.metric)} delta={{ direction: 'up', label: widget.metric }} />
        </div>
      );
    }
    case 'line':
      return (
        <Card title={widget.title}>
          <LineChart
            series={[{ name: widget.metric, color: '#7c5cff', data }]}
            xLabels={labels}
            ariaLabel={widget.title}
            height={180}
          />
        </Card>
      );
    case 'table':
      return (
        <Card title={widget.title}>
          <ul className="flex flex-col gap-1 text-sm">
            {['web', 'api', 'worker', 'ios', 'android'].map((p, i) => (
              <li key={p} className="flex items-center justify-between rounded border border-sr-border/60 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{p}</Badge>
                  <span className="text-xs text-sr-muted">{widget.metric}</span>
                </div>
                <span className="tabular-nums text-sr-fg">{(data[i] as number)?.toFixed(2) ?? '-'}</span>
              </li>
            ))}
          </ul>
        </Card>
      );
  }
}

function fmtBig(v: number, metric: string): string {
  if (metric.includes('apdex')) return v.toFixed(2);
  if (metric.includes('failure')) return `${(v * 100).toFixed(2)}%`;
  return Math.round(v).toLocaleString();
}