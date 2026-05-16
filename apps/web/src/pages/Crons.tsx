import type { JSX } from 'react';
import { Badge, type BadgeTone } from '../components/Badge';
import { Card } from '../components/Card';
import { Table, type TableColumn } from '../components/Table';
import { MOCK_CRONS } from '../data/mock';
import type { CronMonitorView } from '../data/types';
import { relativeTime } from './IssuesList';

const STATUS_TONE: Readonly<Record<CronMonitorView['status'], BadgeTone>> = {
  ok: 'success',
  error: 'error',
  missed: 'warning',
  timeout: 'fatal',
  disabled: 'neutral',
  'never-run': 'neutral',
};

export function Crons(): JSX.Element {
  const columns: readonly TableColumn<CronMonitorView>[] = [
    {
      key: 'slug',
      header: 'Monitor',
      render: (row) => (
        <div>
          <div className="font-medium">{row.slug}</div>
          <div className="mt-0.5 font-mono text-xs text-sr-muted">{row.schedule}</div>
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
      key: 'last',
      header: 'Last run',
      align: 'right',
      render: (row) => (
        <div className="text-xs text-sr-muted">
          <div>{relativeTime(row.lastRunAt)}</div>
          {row.lastRunDurationMs !== undefined && (
            <div className="tabular-nums">{row.lastRunDurationMs}ms</div>
          )}
        </div>
      ),
      width: '140px',
    },
    {
      key: 'next',
      header: 'Next run',
      align: 'right',
      render: (row) => <span className="text-xs text-sr-muted">{row.nextRunAt}</span>,
      width: '200px',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Crons</h1>
        <p className="mt-1 text-sm text-sr-muted">{MOCK_CRONS.length} monitors · all projects</p>
      </header>
      <Card>
        <Table columns={columns} rows={MOCK_CRONS} rowKey={(r) => r.id} />
      </Card>
    </div>
  );
}
