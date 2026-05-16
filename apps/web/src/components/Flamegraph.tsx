import type { JSX } from 'react';
import { useState } from 'react';

export interface FlameNode {
  readonly name: string;
  readonly self: number;
  readonly total: number;
  readonly children?: readonly FlameNode[];
}

export interface FlamegraphProps {
  readonly root: FlameNode;
  readonly height?: number;
}

const COLORS = ['#7c5cff', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa'];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length] as string;
}

interface HoverData {
  readonly name: string;
  readonly self: number;
  readonly total: number;
}

export function Flamegraph({ root, height = 280 }: FlamegraphProps): JSX.Element {
  const [hover, setHover] = useState<HoverData | null>(null);
  const rowHeight = 22;
  const totalTime = Math.max(1, root.total);
  const rects: JSX.Element[] = [];

  function walk(node: FlameNode, depth: number, offset: number, key: string): void {
    const widthPct = (node.total / totalTime) * 100;
    const leftPct = (offset / totalTime) * 100;
    const isHover = hover !== null && hover.name === node.name && hover.self === node.self && hover.total === node.total;
    rects.push(
      <g key={key}>
        <rect
          x={`${leftPct}%`}
          y={depth * rowHeight}
          width={`${Math.max(0.1, widthPct)}%`}
          height={rowHeight - 1}
          fill={colorFor(node.name)}
          opacity={isHover ? 0.85 : 0.7}
          stroke={isHover ? '#fff' : 'transparent'}
          strokeWidth={isHover ? 0.5 : 0}
          onMouseEnter={() => setHover({ name: node.name, self: node.self, total: node.total })}
          onMouseLeave={() => setHover(null)}
          data-testid={`flame-${node.name}`}
          style={{ cursor: 'pointer' }}
        />
        {widthPct > 4 && (
          <text
            x={`${leftPct + 0.4}%`}
            y={depth * rowHeight + (rowHeight - 1) / 2 + 4}
            fill="#0b0d12"
            fontSize={11}
            fontWeight={500}
            style={{ pointerEvents: 'none' }}
          >
            {node.name}
          </text>
        )}
      </g>,
    );
    let childOffset = offset;
    let i = 0;
    for (const c of node.children ?? []) {
      walk(c, depth + 1, childOffset, `${key}.${i}`);
      childOffset += c.total;
      i++;
    }
  }
  walk(root, 0, 0, 'r');

  return (
    <div className="w-full">
      <svg width="100%" height={height} role="img" aria-label="flamegraph">
        {rects}
      </svg>
      <div className="mt-1 font-mono text-xs text-sr-muted" data-testid="flame-hover-info">
        {hover ? (
          <>
            <span className="text-sr-fg">{hover.name}</span> · self {hover.self}ms · total {hover.total}ms
          </>
        ) : (
          'Hover a frame to see its self / total time.'
        )}
      </div>
    </div>
  );
}