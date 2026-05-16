import type { JSX } from 'react';
import { useApp, type Toast as ToastModel } from '../state/AppContext';

const TONE_RING: Readonly<Record<ToastModel['tone'], string>> = {
  info: 'border-sr-border bg-sr-panel',
  success: 'border-sr-success/40 bg-sr-success/10',
  warning: 'border-sr-warning/40 bg-sr-warning/10',
  error: 'border-sr-error/40 bg-sr-error/10',
};

const TONE_DOT: Readonly<Record<ToastModel['tone'], string>> = {
  info: 'bg-sr-accent',
  success: 'bg-sr-success',
  warning: 'bg-sr-warning',
  error: 'bg-sr-error',
};

export function ToastContainer(): JSX.Element | null {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-40 flex w-80 flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid={`toast-${t.tone}`}
          className={['pointer-events-auto rounded-md border px-4 py-3 shadow-lg', TONE_RING[t.tone]].join(' ')}
        >
          <div className="flex items-start gap-2">
            <span className={['mt-1 h-2 w-2 flex-shrink-0 rounded-full', TONE_DOT[t.tone]].join(' ')} />
            <div className="flex-1">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-sr-muted">{t.body}</div>}
            </div>
            <button
              type="button"
              aria-label="dismiss"
              onClick={() => dismissToast(t.id)}
              className="text-sr-muted hover:text-sr-fg"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}