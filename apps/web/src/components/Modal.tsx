import type { JSX, ReactNode } from 'react';
import { useEffect } from 'react';

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
}

const SIZE: Readonly<Record<NonNullable<ModalProps['size']>, string>> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={['w-full overflow-hidden rounded-lg border border-sr-border bg-sr-panel shadow-2xl', SIZE[size]].join(' ')}>
        <header className="flex items-center justify-between border-b border-sr-border px-5 py-3">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="rounded p-1 text-sr-muted hover:bg-white/5 hover:text-sr-fg"
          >
            ×
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-sr-border bg-sr-bg/30 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}