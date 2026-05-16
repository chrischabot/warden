import type { JSX, ReactNode } from 'react';

export interface TableColumn<T> {
  readonly key: string;
  readonly header: ReactNode;
  readonly render: (row: T) => ReactNode;
  readonly align?: 'left' | 'right' | 'center';
  readonly width?: string;
}

export interface TableProps<T> {
  readonly columns: readonly TableColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly onRowClick?: (row: T) => void;
  readonly emptyMessage?: ReactNode;
}

const ALIGN: Readonly<Record<NonNullable<TableColumn<unknown>['align']>, string>> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyMessage,
}: TableProps<T>): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="px-5 py-10 text-center text-sm text-sr-muted">
        {emptyMessage ?? 'No data.'}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-sr-muted">
          <tr className="border-b border-sr-border">
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={['px-3 py-2 font-medium', ALIGN[col.align ?? 'left']].join(' ')}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={[
                'border-b border-sr-border/50 last:border-0',
                onRowClick ? 'cursor-pointer hover:bg-white/[0.03]' : '',
              ].join(' ')}
            >
              {columns.map((col) => (
                <td key={col.key} className={['px-3 py-2', ALIGN[col.align ?? 'left']].join(' ')}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
