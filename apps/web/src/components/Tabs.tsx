import type { JSX, ReactNode } from 'react';

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly badge?: ReactNode;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  readonly ariaLabel?: string;
}

export function Tabs({ items, activeId, onChange, ariaLabel }: TabsProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel ?? 'tabs'}
      className="flex items-center gap-1 border-b border-sr-border"
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`tabpanel-${item.id}`}
            onClick={() => onChange(item.id)}
            className={[
              'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-sr-accent text-sr-fg'
                : 'border-transparent text-sr-muted hover:text-sr-fg',
            ].join(' ')}
          >
            {item.label}
            {item.badge && (
              <span className="rounded-full bg-sr-bg/60 px-1.5 py-0.5 text-[10px] text-sr-muted">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}