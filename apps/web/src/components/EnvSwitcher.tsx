import type { JSX } from 'react';
import { useApp, type Environment } from '../state/AppContext';

const OPTIONS: ReadonlyArray<{ readonly value: Environment; readonly label: string }> = [
  { value: 'production', label: 'production' },
  { value: 'staging', label: 'staging' },
  { value: 'development', label: 'development' },
  { value: 'all', label: 'all envs' },
];

export function EnvSwitcher(): JSX.Element {
  const { environment, setEnvironment } = useApp();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-sr-muted">env:</span>
      <select
        aria-label="environment"
        value={environment}
        onChange={(e) => setEnvironment(e.target.value as Environment)}
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