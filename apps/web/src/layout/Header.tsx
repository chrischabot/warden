import type { JSX } from 'react';
import { useState } from 'react';
import { EnvSwitcher } from '../components/EnvSwitcher';
import { openShortcuts } from '../components/KeyboardShortcuts';
import { NotificationsPanel } from '../components/NotificationsPanel';
import { TimeRangePicker } from '../components/TimeRangePicker';
import { Tooltip } from '../components/Tooltip';
import { useApp } from '../state/AppContext';

export function Header(): JSX.Element {
  const { openPalette } = useApp();
  const [search, setSearch] = useState('');

  return (
    <header className="flex h-14 items-center gap-3 border-b border-sr-border bg-sr-panel px-6">
      <EnvSwitcher />
      <TimeRangePicker />
      <div className="flex-1">
        <button
          type="button"
          aria-label="open command palette"
          onClick={openPalette}
          data-testid="open-palette"
          className="flex w-full max-w-xl items-center justify-between gap-3 rounded-md border border-sr-border bg-sr-bg px-3 py-1.5 text-sm text-sr-muted transition-colors hover:border-sr-accent/40 hover:text-sr-fg"
        >
          <span>Search or jump to…</span>
          <kbd className="rounded border border-sr-border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </button>
      </div>
      <input
        type="search"
        placeholder="Quick filter"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="quick filter"
        className="hidden w-44 rounded-md border border-sr-border bg-sr-bg px-3 py-1.5 text-sm placeholder:text-sr-muted focus:border-sr-accent focus:outline-none lg:block"
      />
      <span aria-label="ingest health" className="flex items-center gap-1.5 text-xs text-sr-muted">
        <span className="h-2 w-2 rounded-full bg-sr-success" />
        ingest healthy
      </span>
      <NotificationsPanel />
      <Tooltip content={<span>Keyboard shortcuts (press ?)</span>}>
        <button
          type="button"
          aria-label="keyboard shortcuts"
          data-testid="help-button"
          onClick={openShortcuts}
          className="flex h-8 w-8 items-center justify-center rounded border border-sr-border bg-sr-bg text-sr-fg hover:bg-white/5"
        >
          ?
        </button>
      </Tooltip>
      <button
        type="button"
        data-testid="invite-teammate"
        className="rounded-md border border-sr-border bg-sr-bg px-3 py-1 text-sm text-sr-fg hover:bg-white/5"
      >
        Invite teammate
      </button>
    </header>
  );
}