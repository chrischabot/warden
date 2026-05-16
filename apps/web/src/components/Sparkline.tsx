import type { JSX } from 'react';

export interface SparklineProps {
  readonly data: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly stroke?: string;
  readonly fill?: string;
  readonly ariaLabel?: string;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = 'currentColor',
  fill = 'none',
  ariaLabel,
}: SparklineProps): JSX.Element {
  if (data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label={ariaLabel ?? 'no data'}
        role="img"
      >
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={stroke} opacity={0.3} strokeDasharray="3 3" />
      </svg>
    );
  }
  let min = data[0] as number;
  let max = data[0] as number;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const polyFill = fill === 'none' ? undefined : `M0,${height} L${points.replace(/ /g, ' L')} L${width},${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={ariaLabel ?? 'sparkline'}
      role="img"
      preserveAspectRatio="none"
    >
      {polyFill && <path d={polyFill} fill={fill} opacity={0.25} />}
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}