import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../state/AppContext';

interface Command {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords: readonly string[];
  run(navigate: ReturnType<typeof useNavigate>, ctx: ReturnType<typeof useApp>): void;
}

const COMMANDS: readonly Command[] = [
  { id: 'go.dashboard', label: 'Go to Dashboard', keywords: ['dashboard', 'overview', 'home'], run: (n) => n('/') },
  { id: 'go.issues', label: 'Go to Issues', keywords: ['issues', 'errors', 'bugs'], run: (n) => n('/issues') },
  { id: 'go.performance', label: 'Go to Performance', keywords: ['performance', 'transactions', 'p95', 'latency'], run: (n) => n('/performance') },
  { id: 'go.traces', label: 'Go to Traces', keywords: ['traces', 'spans', 'waterfall'], run: (n) => n('/traces') },
  { id: 'go.profiles', label: 'Go to Profiles', keywords: ['profiles', 'flame', 'cpu'], run: (n) => n('/profiles') },
  { id: 'go.discover', label: 'Open Discover', description: 'Build ad-hoc queries', keywords: ['discover', 'query', 'explore', 'search'], run: (n) => n('/discover') },
  { id: 'go.alerts', label: 'Go to Alerts', keywords: ['alerts', 'notifications', 'rules'], run: (n) => n('/alerts') },
  { id: 'go.dashboards', label: 'Go to Dashboards', keywords: ['dashboards', 'widgets', 'charts'], run: (n) => n('/dashboards') },
  { id: 'go.crons', label: 'Go to Crons', keywords: ['crons', 'monitors', 'schedule'], run: (n) => n('/crons') },
  { id: 'go.uptime', label: 'Go to Uptime', keywords: ['uptime', 'http checks'], run: (n) => n('/uptime') },
  { id: 'go.releases', label: 'Go to Releases', keywords: ['releases', 'deploys', 'versions'], run: (n) => n('/releases') },
  { id: 'go.sourcemaps', label: 'Go to Source Maps', keywords: ['source maps', 'sourcemaps', 'symbolicate'], run: (n) => n('/source-maps') },
  { id: 'go.savedsearches', label: 'Go to Saved Searches', keywords: ['saved', 'searches', 'queries'], run: (n) => n('/saved-searches') },
  { id: 'go.sdksetup', label: 'Open SDK Setup wizard', keywords: ['sdk', 'setup', 'wizard', 'onboard'], run: (n) => n('/sdk-setup') },
  { id: 'go.settings', label: 'Go to Settings', keywords: ['settings', 'config', 'preferences'], run: (n) => n('/settings') },
  { id: 'env.prod', label: 'Switch environment: production', keywords: ['env', 'environment', 'production', 'prod'], run: (_n, ctx) => { ctx.setEnvironment('production'); ctx.pushToast({ tone: 'info', title: 'Environment set to production' }); } },
  { id: 'env.staging', label: 'Switch environment: staging', keywords: ['env', 'staging'], run: (_n, ctx) => { ctx.setEnvironment('staging'); ctx.pushToast({ tone: 'info', title: 'Environment set to staging' }); } },
  { id: 'range.24h', label: 'Set time range: last 24 hours', keywords: ['time', 'range', '24', 'day'], run: (_n, ctx) => { ctx.setTimeRange('24h'); ctx.pushToast({ tone: 'info', title: 'Time range set to 24 hours' }); } },
  { id: 'range.7d', label: 'Set time range: last 7 days', keywords: ['time', 'range', '7', 'week'], run: (_n, ctx) => { ctx.setTimeRange('7d'); ctx.pushToast({ tone: 'info', title: 'Time range set to 7 days' }); } },
];

export function CommandPalette(): JSX.Element | null {
  const ctx = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ctx.togglePalette();
      } else if (e.key === 'Escape' && ctx.paletteOpen) {
        e.preventDefault();
        ctx.closePalette();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ctx]);

  useEffect(() => {
    if (!ctx.paletteOpen) {
      setQuery('');
      setActive(0);
    }
  }, [ctx.paletteOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => {
      if (c.label.toLowerCase().includes(q)) return true;
      if (c.description?.toLowerCase().includes(q)) return true;
      return c.keywords.some((k) => k.includes(q));
    });
  }, [query]);

  if (!ctx.paletteOpen) return null;

  function run(cmd: Command): void {
    cmd.run(navigate, ctx);
    ctx.closePalette();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) ctx.closePalette();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-sr-border bg-sr-panel shadow-2xl">
        <input
          autoFocus
          type="text"
          aria-label="command palette search"
          placeholder="Type a command or jump to a page..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(filtered.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const cmd = filtered[active];
              if (cmd) run(cmd);
            }
          }}
          className="w-full border-b border-sr-border bg-sr-bg/30 px-4 py-3 text-sm placeholder:text-sr-muted focus:outline-none"
        />
        <ul role="listbox" aria-label="commands" className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-center text-sm text-sr-muted">No matching commands.</li>
          )}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
              className={[
                'cursor-pointer px-4 py-2 text-sm',
                i === active ? 'bg-sr-accent/20 text-sr-fg' : 'text-sr-fg/90 hover:bg-white/5',
              ].join(' ')}
            >
              <div className="font-medium">{c.label}</div>
              {c.description && <div className="text-xs text-sr-muted">{c.description}</div>}
            </li>
          ))}
        </ul>
        <footer className="flex items-center justify-between border-t border-sr-border bg-sr-bg/40 px-4 py-2 text-xs text-sr-muted">
          <span>
            <kbd className="rounded border border-sr-border px-1">↑</kbd>{' '}
            <kbd className="rounded border border-sr-border px-1">↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded border border-sr-border px-1">Enter</kbd> run{' '}
            <kbd className="rounded border border-sr-border px-1">Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}