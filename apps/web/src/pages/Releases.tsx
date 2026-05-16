import type { JSX } from 'react';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { Table, type TableColumn } from '../components/Table';
import { MOCK_RELEASES } from '../data/mock';
import type { ReleaseView } from '../data/types';
import { relativeTime } from './IssuesList';

export function Releases(): JSX.Element {
  const columns: readonly TableColumn<ReleaseView>[] = [
    {
      key: 'version',
      header: 'Version',
      render: (row) => <span className="font-mono text-sm">{row.version}</span>,
    },
    {
      key: 'envs',
      header: 'Environments',
      render: (row) => (
        <div className="flex gap-1.5">
          {row.environments.map((e) => (
            <Badge key={e} tone="neutral">
              {e}
            </Badge>
          ))}
        </div>
      ),
      width: '240px',
    },
    {
      key: 'commits',
      header: 'Commits',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.commitCount}</span>,
      width: '90px',
    },
    {
      key: 'newIssues',
      header: 'New issues',
      align: 'right',
      render: (row) => (
        <span className={row.newIssues > 0 ? 'text-sr-warning' : 'text-sr-muted'}>
          {row.newIssues}
        </span>
      ),
      width: '110px',
    },
    {
      key: 'crashFree',
      header: 'Crash-free users',
      align: 'right',
      render: (row) => (
        <span className={row.crashFreeUsers < 99 ? 'text-sr-warning' : 'text-sr-success'}>
          {row.crashFreeUsers.toFixed(2)}%
        </span>
      ),
      width: '140px',
    },
    {
      key: 'deployedAt',
      header: 'Deployed',
      align: 'right',
      render: (row) => (
        <span className="text-xs text-sr-muted">{relativeTime(row.deployedAt)}</span>
      ),
      width: '120px',
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Releases</h1>
        <p className="mt-1 text-sm text-sr-muted">{MOCK_RELEASES.length} releases · last 7 days</p>
      </header>
      <Card>
        <Table columns={columns} rows={MOCK_RELEASES} rowKey={(r) => r.version} />
      </Card>
    </div>
  );
}
