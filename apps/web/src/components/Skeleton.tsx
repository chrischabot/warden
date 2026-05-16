import type { JSX } from 'react';

export interface SkeletonProps {
  readonly className?: string;
  readonly width?: string | number;
  readonly height?: string | number;
  readonly rounded?: 'sm' | 'md' | 'full';
}

export function Skeleton({ className, width, height, rounded = 'md' }: SkeletonProps): JSX.Element {
  const radius = rounded === 'full' ? 'rounded-full' : rounded === 'sm' ? 'rounded-sm' : 'rounded-md';
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label="loading"
      className={['inline-block animate-pulse bg-white/5', radius, className ?? ''].join(' ')}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
}