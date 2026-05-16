import type { JSX, ReactNode } from 'react';
import { useState } from 'react';

export interface TooltipProps {
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
}

const SIDE: Readonly<Record<NonNullable<TooltipProps['side']>, string>> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

export function Tooltip({ content, children, side = 'top' }: TooltipProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={[
            'pointer-events-none absolute z-30 whitespace-nowrap rounded-md border border-sr-border bg-sr-panel px-2 py-1 text-xs text-sr-fg shadow-lg',
            SIDE[side],
          ].join(' ')}
        >
          {content}
        </span>
      )}
    </span>
  );
}