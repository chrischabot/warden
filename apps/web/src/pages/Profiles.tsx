import type { JSX } from 'react';
import { useState } from 'react';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Flamegraph } from '../components/Flamegraph';
import { Table, type TableColumn } from '../components/Table';
import { MOCK_PROFILES, getFlame, type ProfileSummary } from '../data/profiles';

export function Profiles(): JSX.Element {
  const [active, setActive] = useState<string | undefined>(MOCK_PROFILES[0]?.id);
  const [platform, setPlatform] = useState<'all' | string>('all');

  const rows = MOCK_PROFILES.filter((p) => platform === 'all' || p.platform === platform);
  const flame = active ? getFlame(active) : undefined;
  const summary = MOCK_PROFILES.find((p) => p.id === active);

  const columns: readonly TableColumn<ProfileSummary>[] = [
    {
      key: 'tx',
      header: 'Transaction',
      render: (r) => (
        <div>
          <div className="font-medium">{r.transaction}</div>
          <div className="mt-0.5 text-xs text-sr-muted">{r.id}</div>
        </div>
      ),
    },
    { key: 'platform', header: 'Platform', render: (r) => <Badge tone="accent">{r.platform}</Badge>, width: '110px' },
    { key: 'project', header: 'Project', render: (r) => <span className="text-sr-muted">{r.project}</span>, width: '90px' },
    { key: 'samples', header: 'Samples', align: 'right', render: (r) => <span className="tabular-nums">{r.samples}</span>, width: '90px' },
    {
      key: 'duration',
      header: 'Duration',
      align: 'right',
      render: (r) => <span className="tabular-nums">{r.durationMs}ms</span>,
      width: '110px',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Profiles</h1>
        <p className="mt-1 text-sm text-sr-muted">{rows.length} profile(s) captured</p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          title="Captured profiles"
          action={
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              aria-label="profile platform"
              data-testid="profile-platform"
              className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs focus:border-sr-accent focus:outline-none"
            >
              <option value="all">all platforms</option>
              <option value="javascript">javascript</option>
              <option value="node">node</option>
              <option value="python">python</option>
            </select>
          }
        >
          {rows.length === 0 ? (
            <EmptyState title="No profiles" body="Try switching platform." testId="profiles-empty" />
          ) : (
            <Table
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setActive(r.id)}
            />
          )}
        </Card>
        <div className="lg:col-span-2">
          <Card
            title={summary ? `Flamegraph — ${summary.transaction}` : 'Flamegraph'}
            action={
              summary && (
                <span className="text-xs text-sr-muted">
                  {summary.platform} · {summary.samples} samples · {summary.durationMs}ms
                </span>
              )
            }
          >
            {flame ? (
              <Flamegraph root={flame} height={320} />
            ) : (
              <EmptyState title="Select a profile" body="Pick a row on the left to render its flamegraph." />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}