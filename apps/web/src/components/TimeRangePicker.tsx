import type { JSX } from 'react';
import { useApp, type TimeRange } from '../state/AppContext';

const OPTIONS: ReadonlyArray<{ readonly value: TimeRange; readonly label: string }> = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

export function TimeRangePicker(): JSX.Element {
  const { timeRange, setTimeRange } = useApp();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-sr-muted">range:</span>
      <select
        aria-label="time range"
        value={timeRange}
        onChange={(e) => setTimeRange(e.target.value as TimeRange)}
        className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-sm text-sr-fg focus:border-sr-accent focus:outline-none"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}