import type { JSX, ReactNode } from 'react';

export interface CardProps {
  readonly title?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Card({ title, action, children, className }: CardProps): JSX.Element {
  return (
    <section
      className={['rounded-lg border border-sr-border bg-sr-panel', className ?? ''].join(' ')}
    >
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-sr-border px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {action ?? null}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
