import type { JSX } from 'react';

export interface WaterfallSpan {
  readonly id: string;
  readonly parentId?: string;
  readonly op: string;
  readonly description: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly status?: 'ok' | 'error' | 'slow';
}

export interface WaterfallProps {
  readonly spans: readonly WaterfallSpan[];
  readonly onSelect?: (id: string) => void;
  readonly selectedId?: string | undefined;
}

const OP_COLORS: Readonly<Record<string, string>> = {
  'http.server': '#7c5cff',
  'http.client': '#22d3ee',
  db: '#4ade80',
  redis: '#f472b6',
  function: '#fbbf24',
  queue: '#a78bfa',
};

function colorFor(op: string, status?: 'ok' | 'error' | 'slow'): string {
  if (status === 'error') return '#f87171';
  if (status === 'slow') return '#fbbf24';
  return OP_COLORS[op] ?? '#7c5cff';
}

export function Waterfall({ spans, onSelect, selectedId }: WaterfallProps): JSX.Element {
  if (spans.length === 0) {
    return <div className="text-sm text-sr-muted">No spans</div>;
  }
  const minStart = Math.min(...spans.map((s) => s.startMs));
  const maxEnd = Math.max(...spans.map((s) => s.startMs + s.durationMs));
  const range = Math.max(1, maxEnd - minStart);

  // Build a depth map by walking parents.
  const idMap = new Map(spans.map((s) => [s.id, s]));
  function depthOf(id: string, seen = new Set<string>()): number {
    if (seen.has(id)) return 0;
    seen.add(id);
    const s = idMap.get(id);
    if (!s || !s.parentId) return 0;
    return 1 + depthOf(s.parentId, seen);
  }

  // Sort by start, then parent-first via depth + start.
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs);

  return (
    <div className="flex flex-col gap-0.5" role="list" aria-label="span waterfall">
      {ordered.map((s) => {
        const left = ((s.startMs - minStart) / range) * 100;
        const width = Math.max(1.2, (s.durationMs / range) * 100);
        const depth = depthOf(s.id);
        const selected = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            role="listitem"
            data-testid={`waterfall-span-${s.id}`}
            onClick={() => onSelect?.(s.id)}
            className={[
              'group grid grid-cols-[260px_1fr_64px] items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-white/[0.04]',
              selected ? 'bg-sr-accent/15' : '',
            ].join(' ')}
          >
            <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 12 }}>
              <span className="rounded bg-sr-bg/80 px-1.5 py-0.5 font-mono text-[10px] uppercase text-sr-muted">
                {s.op}
              </span>
              <span className="truncate text-sr-fg" title={s.description}>{s.description}</span>
            </div>
            <div className="relative h-3 rounded bg-sr-bg/40">
              <span
                className="absolute top-0 h-3 rounded"
                style={{ left: `${left}%`, width: `${width}%`, backgroundColor: colorFor(s.op, s.status) }}
              />
            </div>
            <div className="text-right tabular-nums text-sr-muted">{s.durationMs.toFixed(0)}ms</div>
          </button>
        );
      })}
    </div>
  );
}