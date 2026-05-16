import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LineChart } from '../components/LineChart';
import { Tabs } from '../components/Tabs';
import { MOCK_ISSUES } from '../data/mock';
import { noisySeries, timeLabels } from '../data/series';
import type { IssueStatus, IssueView } from '../data/types';
import { useApp } from '../state/AppContext';

const TAGS_MOCK = [
  { key: 'environment', value: 'production', count: 4218 },
  { key: 'release', value: 'web@2.14.3', count: 3210 },
  { key: 'browser', value: 'Chrome 124', count: 2901 },
  { key: 'os', value: 'macOS', count: 1840 },
  { key: 'url', value: '/dashboard', count: 1602 },
];

const BREADCRUMBS_MOCK = [
  { ts: '11:55:01.213', category: 'navigation', message: 'navigated to /dashboard', level: 'info' as const },
  { ts: '11:55:02.812', category: 'ui.click', message: 'button.refresh clicked', level: 'info' as const },
  { ts: '11:55:03.001', category: 'fetch', message: 'GET /api/users 200 (134ms)', level: 'info' as const },
  { ts: '11:55:03.150', category: 'console', message: 'session expired (user=null)', level: 'warning' as const },
  { ts: '11:55:03.180', category: 'exception', message: "TypeError: cannot read properties of undefined ('user')", level: 'error' as const },
];

const ACTIVITY_MOCK = [
  { who: 'alice', when: '2 days ago', what: 'created' },
  { who: 'bob', when: '1 day ago', what: 'commented "looks like a session expiry race"' },
  { who: 'system', when: '4 hours ago', what: 'auto-grouped 432 events' },
  { who: 'carol', when: '32 minutes ago', what: 'assigned to alice' },
];

type DetailTab = 'stack' | 'breadcrumbs' | 'tags' | 'activity';

export function IssueDetail(): JSX.Element {
  const ctx = useApp();
  const { id } = useParams<{ id: string }>();
  const base = MOCK_ISSUES.find((i) => i.id === id);
  const [issue, setIssue] = useState<IssueView | undefined>(base);
  const [tab, setTab] = useState<DetailTab>('stack');

  const eventsChart = useMemo(() => {
    const length = 24;
    return {
      labels: timeLabels(ctx.timeRange, length),
      data: noisySeries(id?.charCodeAt(0) ?? 1, length, 220, 80, 0),
    };
  }, [ctx.timeRange, id]);

  if (!issue) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Unknown issue</h1>
        <p className="text-sm text-sr-muted">
          No issue with id "{id}". <Link to="/issues" className="text-sr-accent hover:underline">Back to all issues</Link>
        </p>
      </div>
    );
  }

  function changeStatus(status: IssueStatus, label: string): void {
    setIssue({ ...issue!, status });
    ctx.pushToast({ tone: 'success', title: `${label}: ${issue!.shortId}` });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-sr-muted">
            <Link to="/issues" className="hover:text-sr-fg">Issues</Link>
            <span>›</span>
            <Badge tone="accent">{issue.project}</Badge>
            <span>·</span>
            <span>{issue.shortId}</span>
            <Badge tone={issue.status === 'unresolved' ? 'error' : issue.status === 'resolved' ? 'success' : 'neutral'}>
              {issue.status}
            </Badge>
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{issue.title}</h1>
          <p className="mt-1 text-sm text-sr-muted">{issue.culprit}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => changeStatus('resolved', 'Resolved')} data-testid="resolve-issue">
            Resolve
          </Button>
          <Button variant="secondary" onClick={() => changeStatus('ignored', 'Ignored')} data-testid="ignore-issue">
            Ignore
          </Button>
          <Button variant="secondary" onClick={() => changeStatus('archived', 'Archived')} data-testid="archive-issue">
            Archive
          </Button>
          <Button variant="ghost" data-testid="assign-issue">Assign…</Button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Events">
          <div className="text-2xl font-semibold tabular-nums">{issue.eventsCount.toLocaleString()}</div>
          <div className="mt-1 text-xs text-sr-muted">across all environments</div>
        </Card>
        <Card title="Users affected">
          <div className="text-2xl font-semibold tabular-nums">{issue.usersAffected}</div>
          <div className="mt-1 text-xs text-sr-muted">distinct user ids</div>
        </Card>
        <Card title="First / last seen">
          <div className="text-sm tabular-nums">2026-05-14T08:11:00Z</div>
          <div className="text-sm tabular-nums">{issue.lastSeen}</div>
        </Card>
      </div>

      <Card title="Events over time">
        <LineChart
          series={[{ name: 'events / min', color: '#7c5cff', data: eventsChart.data }]}
          xLabels={eventsChart.labels}
          ariaLabel="issue events over time"
          height={180}
        />
      </Card>

      <Card>
        <Tabs
          activeId={tab}
          onChange={(id) => setTab(id as DetailTab)}
          items={[
            { id: 'stack', label: 'Stack trace' },
            { id: 'breadcrumbs', label: 'Breadcrumbs', badge: BREADCRUMBS_MOCK.length },
            { id: 'tags', label: 'Tags', badge: TAGS_MOCK.length },
            { id: 'activity', label: 'Activity', badge: ACTIVITY_MOCK.length },
          ]}
          ariaLabel="issue detail tabs"
        />
        <div id={`tabpanel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-4">
          {tab === 'stack' && (
            <pre className="overflow-x-auto rounded bg-sr-bg p-3 font-mono text-xs leading-relaxed text-sr-fg">
{`File "src/components/Header.tsx", line 42, in renderHeader
    const name = user.name;
TypeError: Cannot read properties of undefined (reading 'user')

  40 |   const { user, settings } = useAppState();
  41 |   // user is undefined when the session has expired
> 42 |   const name = user.name;
  43 |   return <h1>{name}</h1>;
  44 | }`}
            </pre>
          )}
          {tab === 'breadcrumbs' && (
            <ul className="flex flex-col gap-1.5 font-mono text-xs">
              {BREADCRUMBS_MOCK.map((b, i) => (
                <li
                  key={i}
                  className={[
                    'flex items-center gap-3 rounded border-l-2 px-3 py-1.5',
                    b.level === 'error'
                      ? 'border-sr-error bg-sr-error/5'
                      : b.level === 'warning'
                      ? 'border-sr-warning bg-sr-warning/5'
                      : 'border-sr-border bg-sr-bg/30',
                  ].join(' ')}
                >
                  <span className="w-24 text-sr-muted">{b.ts}</span>
                  <Badge tone={b.level === 'error' ? 'error' : b.level === 'warning' ? 'warning' : 'neutral'}>
                    {b.category}
                  </Badge>
                  <span className="flex-1">{b.message}</span>
                </li>
              ))}
            </ul>
          )}
          {tab === 'tags' && (
            <ul className="flex flex-col gap-1.5">
              {TAGS_MOCK.map((t) => (
                <li key={t.key} className="flex items-center justify-between rounded border border-sr-border/50 px-3 py-2 text-sm">
                  <div className="font-mono text-xs">
                    <span className="text-sr-muted">{t.key}</span>
                    <span className="mx-1.5 text-sr-muted">=</span>
                    <span>{t.value}</span>
                  </div>
                  <span className="tabular-nums text-xs text-sr-muted">{t.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          {tab === 'activity' && (
            <ul className="flex flex-col gap-2">
              {ACTIVITY_MOCK.map((a, i) => (
                <li key={i} className="flex items-center gap-3 rounded border border-sr-border/50 px-3 py-2 text-sm">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sr-accent/20 text-xs uppercase text-sr-accent">
                    {a.who.charAt(0)}
                  </span>
                  <span>
                    <strong>{a.who}</strong> {a.what}
                  </span>
                  <span className="ml-auto text-xs text-sr-muted">{a.when}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title="Seer suggestion (heuristic)">
        <Badge tone="accent">Property access on undefined or null value</Badge>
        <p className="mt-2 text-sm text-sr-fg">
          The stack indicates a <code className="font-mono text-xs">.name</code> access on a value that resolved to undefined. Add a guard at the top of <code className="font-mono text-xs">renderHeader</code> or trace the assignment that left <code className="font-mono text-xs">user</code> unset.
        </p>
        <p className="mt-2 text-xs text-sr-muted">Confidence: 0.75 · Provider: heuristic</p>
      </Card>
    </div>
  );
}