import type { JSX } from 'react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { LineChart } from '../components/LineChart';
import { Sparkline } from '../components/Sparkline';
import { Stat } from '../components/Stat';
import { MOCK_ISSUES, MOCK_UPTIME } from '../data/mock';
import { noisySeries, spikySeries, timeLabels } from '../data/series';
import { useApp } from '../state/AppContext';

export function Dashboard(): JSX.Element {
  const ctx = useApp();
  const length = ctx.timeRange === '1h' ? 30 : ctx.timeRange === '24h' ? 24 : 30;
  const charts = useMemo(
    () => ({
      events: noisySeries(101, length, 8000, 1200, 50),
      errors: noisySeries(202, length, 80, 30, 0),
      latency: noisySeries(303, length, 240, 60, -1),
      sessions: spikySeries(404, length, 1200, 800),
    }),
    [length],
  );
  const labels = useMemo(() => timeLabels(ctx.timeRange, length), [ctx.timeRange, length]);
  const envLabel = ctx.environment === 'all' ? 'all envs' : ctx.environment;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-sr-muted">
          Showing <strong className="text-sr-fg">{envLabel}</strong> · time range <strong className="text-sr-fg">{ctx.timeRange}</strong>
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatWithSpark label="Events / s" value="8,940" delta={{ direction: 'up', label: '+12%' }} data={charts.events} stroke="#7c5cff" />
        <StatWithSpark label="Errors / min" value="142" tone="warning" delta={{ direction: 'down', label: '-3%' }} data={charts.errors} stroke="#f87171" />
        <StatWithSpark label="p95 latency" value="248ms" tone="success" delta={{ direction: 'flat', label: 'within SLO' }} data={charts.latency} stroke="#4ade80" />
        <StatWithSpark label="Sessions" value="14.2k" delta={{ direction: 'up', label: '+5%' }} data={charts.sessions} stroke="#fbbf24" />
      </div>

      <Card title="Events over time">
        <LineChart
          series={[
            { name: 'errors', color: '#f87171', data: charts.errors },
            { name: 'events', color: '#7c5cff', data: charts.events.map((v) => v / 100) },
          ]}
          xLabels={labels}
          ariaLabel="events over time"
          yLabel="count"
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Recent issues" action={<Link to="/issues" className="text-xs text-sr-accent hover:underline">View all</Link>}>
          <ul className="flex flex-col gap-3">
            {MOCK_ISSUES.slice(0, 3).map((issue) => (
              <li key={issue.id} className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={badgeToneFor(issue.level)}>{issue.level}</Badge>
                    <Link to={`/issues/${issue.id}`} className="text-sm font-medium hover:text-sr-accent">
                      {issue.title}
                    </Link>
                  </div>
                  <div className="mt-1 text-xs text-sr-muted">
                    {issue.shortId} · {issue.culprit}
                  </div>
                </div>
                <div className="text-right text-xs text-sr-muted">
                  <div className="tabular-nums">{issue.eventsCount.toLocaleString()} events</div>
                  <div className="tabular-nums">{issue.usersAffected} users</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Uptime checks" action={<Link to="/uptime" className="text-xs text-sr-accent hover:underline">View all</Link>}>
          <ul className="flex flex-col gap-2">
            {MOCK_UPTIME.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded border border-sr-border/60 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={uptimeBadgeFor(c.status)}>{c.status}</Badge>
                  <span>{c.name}</span>
                  <span className="text-xs text-sr-muted">{c.url}</span>
                </div>
                <div className="text-xs tabular-nums text-sr-muted">{c.uptimePct}% · {c.responseTimeMs}ms</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function StatWithSpark({
  label,
  value,
  tone,
  delta,
  data,
  stroke,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'error';
  readonly delta?: { readonly direction: 'up' | 'down' | 'flat'; readonly label: string };
  readonly data: readonly number[];
  readonly stroke: string;
}): JSX.Element {
  return (
    <div className="relative rounded-lg border border-sr-border bg-sr-panel">
      <div className="absolute right-2 top-2" style={{ color: stroke }}>
        <Sparkline data={data} width={84} height={28} stroke="currentColor" fill="currentColor" ariaLabel={`${label} trend`} />
      </div>
      <div className="px-5 py-4">
        <Stat label={label} value={value} {...(tone !== undefined ? { tone } : {})} {...(delta ? { delta } : {})} />
      </div>
    </div>
  );
}

function badgeToneFor(level: string): 'fatal' | 'error' | 'warning' | 'neutral' {
  switch (level) {
    case 'fatal': return 'fatal';
    case 'error': return 'error';
    case 'warning': return 'warning';
    default: return 'neutral';
  }
}

function uptimeBadgeFor(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'up': return 'success';
    case 'degraded': return 'warning';
    case 'down': return 'error';
    default: return 'neutral';
  }
}