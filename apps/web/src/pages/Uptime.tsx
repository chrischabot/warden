import type { JSX } from 'react';
import { Badge, type BadgeTone } from '../components/Badge';
import { Card } from '../components/Card';
import { Table, type TableColumn } from '../components/Table';
import { MOCK_UPTIME } from '../data/mock';
import type { UptimeCheckView } from '../data/types';
import { relativeTime } from './IssuesList';

const STATUS_TONE: Readonly<Record<UptimeCheckView['status'], BadgeTone>> = {
  up: 'success',
  degraded: 'warning',
  down: 'error',
  unknown: 'neutral',
};

export function Uptime(): JSX.Element {
  const columns: readonly TableColumn<UptimeCheckView>[] = [
    {
      key: 'name',
      header: 'Check',
      render: (row) => (
        <div>
          <div className="font-medium">{row.name}</div>
          <div className="mt-0.5 text-xs text-sr-muted">{row.url}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
      width: '120px',
    },
    {
      key: 'uptime',
      header: 'Uptime (7d)',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.uptimePct.toFixed(2)}%</span>,
      width: '120px',
    },
    {
      key: 'rt',
      header: 'Response',
      align: 'right',
      render: (row) => <span className="tabular-nums">{row.responseTimeMs}ms</span>,
      width: '100px',
    },
    {
      key: 'last',
      header: 'Last checked',
      align: 'right',
      render: (row) => (
        <span className="text-xs text-sr-muted">{relativeTime(row.lastCheckedAt)}</span>
      ),
      width: '140px',
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Uptime</h1>
        <p className="mt-1 text-sm text-sr-muted">{MOCK_UPTIME.length} checks</p>
      </header>
      <Card>
        <Table columns={columns} rows={MOCK_UPTIME} rowKey={(r) => r.id} />
      </Card>
    </div>
  );
}
