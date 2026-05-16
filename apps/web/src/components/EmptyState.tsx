import type { JSX, ReactNode } from 'react';

export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly testId?: string;
}

export function EmptyState({ icon, title, body, action, testId }: EmptyStateProps): JSX.Element {
  return (
    <div
      data-testid={testId ?? 'empty-state'}
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-sr-border/60 px-6 py-14 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sr-accent/10 text-2xl text-sr-accent" aria-hidden>
        {icon ?? '○'}
      </div>
      <div>
        <div className="text-base font-medium">{title}</div>
        {body && <p className="mx-auto mt-1 max-w-sm text-sm text-sr-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}