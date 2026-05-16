import type { JSX } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { useApp } from '../state/AppContext';

interface SavedSearch {
  readonly id: string;
  readonly name: string;
  readonly query: string;
  readonly target: 'issues' | 'discover' | 'performance';
  readonly pinned: boolean;
  readonly createdAt: string;
}

const SEED: readonly SavedSearch[] = [
  {
    id: 'ss1',
    name: 'Unresolved fatal errors',
    query: 'is:unresolved level:fatal',
    target: 'issues',
    pinned: true,
    createdAt: '2026-04-12T08:00:00Z',
  },
  {
    id: 'ss2',
    name: 'Slow API endpoints (p95 > 1s)',
    query: 'p95(duration):>1000 op:http.server',
    target: 'performance',
    pinned: true,
    createdAt: '2026-04-13T09:30:00Z',
  },
  {
    id: 'ss3',
    name: 'Errors by release',
    query: 'level:error group_by:release',
    target: 'discover',
    pinned: false,
    createdAt: '2026-04-20T15:18:00Z',
  },
];

export function SavedSearches(): JSX.Element {
  const ctx = useApp();
  const [items, setItems] = useState<SavedSearch[]>([...SEED]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    query: '',
    target: 'issues' as SavedSearch['target'],
  });

  function create(): void {
    if (!form.name.trim() || !form.query.trim()) {
      ctx.pushToast({ tone: 'warning', title: 'Name and query are required' });
      return;
    }
    const s: SavedSearch = {
      id: `ss${items.length + 1}_${Date.now().toString(36).slice(-3)}`,
      name: form.name.trim(),
      query: form.query.trim(),
      target: form.target,
      pinned: false,
      createdAt: new Date().toISOString(),
    };
    setItems([s, ...items]);
    setForm({ name: '', query: '', target: 'issues' });
    setCreateOpen(false);
    ctx.pushToast({ tone: 'success', title: `Saved "${s.name}"` });
  }

  function togglePin(id: string): void {
    setItems(items.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s)));
  }

  function remove(id: string): void {
    setItems(items.filter((s) => s.id !== id));
    ctx.pushToast({ tone: 'info', title: 'Saved search removed' });
  }

  const pinned = items.filter((i) => i.pinned);
  const others = items.filter((i) => !i.pinned);

  function targetTone(t: SavedSearch['target']): 'accent' | 'success' | 'neutral' {
    return t === 'issues' ? 'accent' : t === 'performance' ? 'success' : 'neutral';
  }

  function row(s: SavedSearch): JSX.Element {
    return (
      <li key={s.id} className="flex items-center justify-between gap-3 rounded border border-sr-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label={s.pinned ? `unpin ${s.name}` : `pin ${s.name}`}
            data-testid={`pin-${s.id}`}
            onClick={() => togglePin(s.id)}
            className={s.pinned ? 'text-sr-warning' : 'text-sr-muted hover:text-sr-fg'}
          >
            {s.pinned ? '★' : '☆'}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={targetTone(s.target)}>{s.target}</Badge>
              <span className="font-medium">{s.name}</span>
            </div>
            <div className="mt-0.5 truncate font-mono text-xs text-sr-muted">{s.query}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link to={`/${s.target}`} className="rounded border border-sr-border bg-sr-bg px-2 py-1 text-xs hover:bg-white/5" data-testid={`run-${s.id}`}>
            Open →
          </Link>
          <Button variant="ghost" onClick={() => remove(s.id)} data-testid={`remove-${s.id}`}>
            Delete
          </Button>
        </div>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Saved searches</h1>
          <p className="mt-1 text-sm text-sr-muted">{items.length} saved · {pinned.length} pinned</p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)} data-testid="create-search">
          New saved search
        </Button>
      </header>

      <Card title="Pinned">
        {pinned.length === 0 ? (
          <EmptyState title="No pinned searches" body="Pin frequently-run searches for quick access." />
        ) : (
          <ul className="flex flex-col gap-2">{pinned.map(row)}</ul>
        )}
      </Card>

      <Card title="All saved searches">
        {others.length === 0 ? (
          <EmptyState title="Nothing else saved" body="Use the New saved search button to add one." />
        ) : (
          <ul className="flex flex-col gap-2">{others.map(row)}</ul>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New saved search"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} data-testid="create-search-confirm">Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-label="search name"
              data-testid="search-name"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Query</span>
            <input
              type="text"
              value={form.query}
              onChange={(e) => setForm({ ...form, query: e.target.value })}
              aria-label="search query"
              data-testid="search-query"
              placeholder="is:unresolved level:error"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 font-mono text-sm focus:border-sr-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Target</span>
            <select
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value as SavedSearch['target'] })}
              aria-label="search target"
              data-testid="search-target"
              className="rounded border border-sr-border bg-sr-bg px-3 py-1.5 text-sm focus:border-sr-accent focus:outline-none"
            >
              <option value="issues">issues</option>
              <option value="discover">discover</option>
              <option value="performance">performance</option>
            </select>
          </label>
        </div>
      </Modal>
    </div>
  );
}