import type { JSX } from 'react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { Table, type TableColumn } from '../components/Table';
import { useApp } from '../state/AppContext';

type AlertStatus = 'ok' | 'firing' | 'paused';

interface AlertRule {
  readonly id: string;
  readonly name: string;
  readonly metric: string;
  readonly threshold: string;
  readonly window: string;
  readonly project: string;
  readonly channel: string;
  readonly target: string;
  readonly status: AlertStatus;
  readonly lastFiredAt?: string;
}

const STATUS_TONE: Readonly<Record<AlertStatus, BadgeTone>> = {
  ok: 'success',
  firing: 'error',
  paused: 'neutral',
};

const SEED_RULES: readonly AlertRule[] = [
  {
    id: 'a1',
    name: 'High error rate (web)',
    metric: 'event_count(level:error)',
    threshold: '> 100',
    window: '5 min',
    project: 'web',
    channel: 'slack',
    target: '#oncall',
    status: 'firing',
    lastFiredAt: '2026-05-16T11:45:00Z',
  },
  {
    id: 'a2',
    name: 'API p95 latency',
    metric: 'p95(transaction.duration)',
    threshold: '> 1500ms',
    window: '10 min',
    project: 'api',
    channel: 'pagerduty',
    target: 'oncall-rotation',
    status: 'ok',
  },
  {
    id: 'a3',
    name: 'Worker job timeouts',
    metric: 'event_count(type:timeout)',
    threshold: '> 5',
    window: '15 min',
    project: 'worker',
    channel: 'email',
    target: 'alerts@example.com',
    status: 'paused',
  },
];

export function Alerts(): JSX.Element {
  const ctx = useApp();
  const [rules, setRules] = useState<AlertRule[]>([...SEED_RULES]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    metric: 'event_count(level:error)',
    threshold: '100',
    window: '5 min',
    project: 'web',
    channel: 'slack',
    target: '#oncall',
  });

  function createAlert(): void {
    if (!form.name.trim()) {
      ctx.pushToast({ tone: 'warning', title: 'Name required' });
      return;
    }
    const id = `a${rules.length + 1}_${Date.now().toString(36).slice(-4)}`;
    const rule: AlertRule = {
      id,
      name: form.name.trim(),
      metric: form.metric,
      threshold: `> ${form.threshold}`,
      window: form.window,
      project: form.project,
      channel: form.channel,
      target: form.target,
      status: 'ok',
    };
    setRules([rule, ...rules]);
    setCreateOpen(false);
    ctx.pushToast({ tone: 'success', title: `Created alert "${rule.name}"` });
    setForm({ ...form, name: '', target: '#oncall' });
  }

  function toggleStatus(id: string): void {
    setRules(
      rules.map((r) =>
        r.id === id ? { ...r, status: r.status === 'paused' ? 'ok' : 'paused' } : r,
      ),
    );
    const r = rules.find((x) => x.id === id);
    if (r) {
      ctx.pushToast({
        tone: 'info',
        title: r.status === 'paused' ? `Resumed "${r.name}"` : `Paused "${r.name}"`,
      });
    }
  }

  const columns: readonly TableColumn<AlertRule>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
      width: '110px',
    },
    {
      key: 'name',
      header: 'Alert',
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="mt-0.5 font-mono text-xs text-sr-muted">{r.metric}</div>
        </div>
      ),
    },
    { key: 'threshold', header: 'Threshold', render: (r) => <span className="font-mono text-xs">{r.threshold}</span>, width: '140px' },
    { key: 'window', header: 'Window', render: (r) => <span className="text-sr-muted">{r.window}</span>, width: '90px' },
    { key: 'project', header: 'Project', render: (r) => <Badge tone="accent">{r.project}</Badge>, width: '110px' },
    {
      key: 'channel',
      header: 'Notify',
      render: (r) => (
        <span className="text-xs">
          <span className="text-sr-muted">{r.channel}</span> → <span className="font-mono">{r.target}</span>
        </span>
      ),
      width: '220px',
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <Button
          variant="ghost"
          onClick={() => toggleStatus(r.id)}
          aria-label={`toggle ${r.name}`}
          data-testid={`toggle-${r.id}`}
        >
          {r.status === 'paused' ? 'Resume' : 'Pause'}
        </Button>
      ),
      width: '120px',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
          <p className="mt-1 text-sm text-sr-muted">{rules.length} rule(s) · {rules.filter((r) => r.status === 'firing').length} firing now</p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)} data-testid="create-alert">
          Create alert
        </Button>
      </header>

      <Card>
        <Table columns={columns} rows={rules} rowKey={(r) => r.id} />
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create alert"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createAlert} data-testid="create-alert-confirm">
              Save
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-label="alert name"
              placeholder="e.g. High error rate on web"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Project</span>
            <select
              value={form.project}
              onChange={(e) => setForm({ ...form, project: e.target.value })}
              aria-label="alert project"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            >
              <option value="web">web</option>
              <option value="api">api</option>
              <option value="worker">worker</option>
              <option value="ios">ios</option>
              <option value="android">android</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Metric</span>
            <select
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
              aria-label="alert metric"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm font-mono focus:border-sr-accent focus:outline-none"
            >
              <option>event_count(level:error)</option>
              <option>event_count(level:fatal)</option>
              <option>p95(transaction.duration)</option>
              <option>p99(transaction.duration)</option>
              <option>failure_rate</option>
              <option>unique_users(level:error)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Threshold (&gt;)</span>
            <input
              type="text"
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              aria-label="alert threshold"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Window</span>
            <select
              value={form.window}
              onChange={(e) => setForm({ ...form, window: e.target.value })}
              aria-label="alert window"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            >
              <option>1 min</option>
              <option>5 min</option>
              <option>10 min</option>
              <option>15 min</option>
              <option>30 min</option>
              <option>1 hour</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Channel</span>
            <select
              value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value })}
              aria-label="alert channel"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            >
              <option>slack</option>
              <option>email</option>
              <option>pagerduty</option>
              <option>opsgenie</option>
              <option>webhook</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">
            <span>Target</span>
            <input
              type="text"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              aria-label="alert target"
              placeholder="#channel, email@example.com, routing key, ..."
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}