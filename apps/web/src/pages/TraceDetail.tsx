import type { JSX } from 'react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { Waterfall, type WaterfallSpan } from '../components/Waterfall';
import { getTraceDetail } from '../data/traces';

export function TraceDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const detail = id ? getTraceDetail(id) : undefined;
  const [selected, setSelected] = useState<string | undefined>(undefined);

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Unknown trace</h1>
        <p className="text-sm text-sr-muted">
          No trace with id "{id}". <Link to="/traces" className="text-sr-accent hover:underline">Back to all traces</Link>
        </p>
      </div>
    );
  }

  const span = detail.spans.find((s) => s.id === selected);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <div className="flex items-center gap-2 text-xs text-sr-muted">
          <Link to="/traces" className="hover:text-sr-fg">Traces</Link>
          <span>›</span>
          <span className="font-mono">{detail.summary.id}</span>
        </div>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone={detail.summary.status === 'error' ? 'error' : 'success'}>{detail.summary.status}</Badge>
              <h1 className="text-xl font-semibold tracking-tight">{detail.summary.rootTransaction}</h1>
            </div>
            <p className="mt-1 text-sm text-sr-muted">{detail.summary.op}</p>
          </div>
          <div className="flex items-center gap-6 text-xs text-sr-muted">
            <div>
              <div className="uppercase">Duration</div>
              <div className="mt-0.5 text-base tabular-nums text-sr-fg">{detail.summary.durationMs}ms</div>
            </div>
            <div>
              <div className="uppercase">Spans</div>
              <div className="mt-0.5 text-base tabular-nums text-sr-fg">{detail.summary.spanCount}</div>
            </div>
            <div>
              <div className="uppercase">Project</div>
              <div className="mt-0.5 text-base text-sr-fg">{detail.summary.project}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Card title="Span waterfall">
            <Waterfall
              spans={detail.spans}
              selectedId={selected}
              onSelect={setSelected}
            />
          </Card>
        </div>
        <Card title="Span detail">
          {span ? <SpanDetail span={span} /> : (
            <p className="text-sm text-sr-muted">Click a span on the left to view its detail.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function SpanDetail({ span }: { span: WaterfallSpan }): JSX.Element {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <Badge tone="accent">{span.op}</Badge>
        {span.status === 'error' && <Badge tone="error">error</Badge>}
        {span.status === 'slow' && <Badge tone="warning">slow</Badge>}
      </div>
      <div className="font-medium" data-testid="selected-span-description">{span.description}</div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="uppercase text-sr-muted">span_id</dt>
          <dd className="mt-0.5 font-mono">{span.id}</dd>
        </div>
        <div>
          <dt className="uppercase text-sr-muted">parent</dt>
          <dd className="mt-0.5 font-mono">{span.parentId ?? '—'}</dd>
        </div>
        <div>
          <dt className="uppercase text-sr-muted">start</dt>
          <dd className="mt-0.5 tabular-nums">{span.startMs}ms</dd>
        </div>
        <div>
          <dt className="uppercase text-sr-muted">duration</dt>
          <dd className="mt-0.5 tabular-nums">{span.durationMs}ms</dd>
        </div>
      </dl>
    </div>
  );
}