import type { JSX, ReactNode } from 'react';

export interface StatProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly delta?: { readonly direction: 'up' | 'down' | 'flat'; readonly label: string };
  readonly tone?: 'neutral' | 'success' | 'warning' | 'error';
}

const TONE_FG: Readonly<Record<NonNullable<StatProps['tone']>, string>> = {
  neutral: 'text-sr-fg',
  success: 'text-sr-success',
  warning: 'text-sr-warning',
  error: 'text-sr-error',
};

const DIRECTION: Readonly<
  Record<'up' | 'down' | 'flat', { readonly symbol: string; readonly className: string }>
> = {
  up: { symbol: '↑', className: 'text-sr-success' },
  down: { symbol: '↓', className: 'text-sr-error' },
  flat: { symbol: '·', className: 'text-sr-muted' },
};

export function Stat({ label, value, delta, tone = 'neutral' }: StatProps): JSX.Element {
  return (
    <div className="rounded-lg border border-sr-border bg-sr-panel px-5 py-4">
      <div className="text-xs uppercase tracking-wide text-sr-muted">{label}</div>
      <div className={['mt-2 text-2xl font-semibold tabular-nums', TONE_FG[tone]].join(' ')}>
        {value}
      </div>
      {delta && (
        <div
          className={['mt-1 text-xs tabular-nums', DIRECTION[delta.direction].className].join(' ')}
        >
          <span aria-hidden>{DIRECTION[delta.direction].symbol}</span> {delta.label}
        </div>
      )}
    </div>
  );
}
