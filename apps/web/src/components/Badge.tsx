import type { JSX, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'fatal' | 'accent';

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-white/5 text-sr-muted',
  success: 'bg-sr-success/15 text-sr-success',
  warning: 'bg-sr-warning/15 text-sr-warning',
  error: 'bg-sr-error/15 text-sr-error',
  fatal: 'bg-sr-fatal/20 text-sr-error',
  accent: 'bg-sr-accent/15 text-sr-accent',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps): JSX.Element {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium tracking-wide uppercase',
        TONE_CLASSES[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}
