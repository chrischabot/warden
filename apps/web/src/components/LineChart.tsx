import type { JSX } from 'react';
import { useState } from 'react';

export interface ChartSeries {
  readonly name: string;
  readonly color: string;
  readonly data: readonly number[];
}

export interface LineChartProps {
  readonly series: readonly ChartSeries[];
  /** X-axis labels (must match series[].data length). */
  readonly xLabels?: readonly string[];
  readonly height?: number;
  readonly yLabel?: string;
  readonly ariaLabel?: string;
}

const PADDING = { top: 12, right: 12, bottom: 26, left: 44 };

export function LineChart({
  series,
  xLabels,
  height = 220,
  yLabel,
  ariaLabel,
}: LineChartProps): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const length = series[0]?.data.length ?? 0;
  if (length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-sr-muted">
        No data in selected window
      </div>
    );
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    for (const v of s.data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === max) {
    max = min + 1;
  }
  const yMin = Math.floor(min * 0.95);
  const yMax = Math.ceil(max * 1.05);
  const range = yMax - yMin || 1;

  const innerWidth = 100; // viewBox uses 0..100 percent-style, scaled by viewport
  const totalWidth = 800;
  const plotW = totalWidth - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;
  const stepX = length > 1 ? plotW / (length - 1) : plotW;

  function xAt(i: number): number {
    return PADDING.left + i * stepX;
  }
  function yAt(v: number): number {
    return PADDING.top + plotH - ((v - yMin) / range) * plotH;
  }

  const gridLines: number[] = [];
  for (let i = 0; i <= 4; i++) {
    gridLines.push(yMin + (range * i) / 4);
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${totalWidth} ${height}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel ?? 'time series chart'}
        onMouseLeave={() => setHover(null)}
      >
        {/* Y-axis grid + labels */}
        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={PADDING.left}
              x2={PADDING.left + plotW}
              y1={yAt(v)}
              y2={yAt(v)}
              stroke="#2a2f3a"
              strokeDasharray="2 4"
            />
            <text x={PADDING.left - 8} y={yAt(v)} fill="#8a92a3" fontSize={10} textAnchor="end" dominantBaseline="middle">
              {fmt(v)}
            </text>
          </g>
        ))}
        {/* X-axis labels (start, mid, end) */}
        {xLabels && (
          <>
            <text x={PADDING.left} y={height - 8} fill="#8a92a3" fontSize={10}>{xLabels[0]}</text>
            <text x={PADDING.left + plotW / 2} y={height - 8} fill="#8a92a3" fontSize={10} textAnchor="middle">
              {xLabels[Math.floor(xLabels.length / 2)]}
            </text>
            <text x={PADDING.left + plotW} y={height - 8} fill="#8a92a3" fontSize={10} textAnchor="end">
              {xLabels[xLabels.length - 1]}
            </text>
          </>
        )}
        {/* Series lines */}
        {series.map((s) => {
          const points = s.data
            .map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`)
            .join(' ');
          return (
            <polyline
              key={s.name}
              points={points}
              fill="none"
              stroke={s.color}
              strokeWidth={1.75}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {/* Hover hit area */}
        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={(e) => {
            const svg = e.currentTarget.ownerSVGElement;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * totalWidth;
            const i = Math.max(0, Math.min(length - 1, Math.round((px - PADDING.left) / stepX)));
            setHover(i);
          }}
        />
        {/* Hover indicator */}
        {hover !== null && (
          <>
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={PADDING.top}
              y2={PADDING.top + plotH}
              stroke="#7c5cff"
              strokeDasharray="2 2"
            />
            {series.map((s) => (
              <circle
                key={s.name}
                cx={xAt(hover)}
                cy={yAt(s.data[hover] as number)}
                r={3}
                fill={s.color}
              />
            ))}
          </>
        )}
      </svg>
      {/* Legend + hover values */}
      <div className="flex items-center justify-between gap-3 px-2 pt-1 text-xs text-sr-muted">
        <div className="flex items-center gap-3">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.name}
              {hover !== null && (
                <span className="tabular-nums text-sr-fg">
                  : {fmt(s.data[hover] as number)}
                </span>
              )}
            </span>
          ))}
        </div>
        {yLabel && <span aria-label="y-axis">{yLabel}</span>}
      </div>
    </div>
  );
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) < 1 && v !== 0) return v.toFixed(2);
  return Math.round(v).toString();
}