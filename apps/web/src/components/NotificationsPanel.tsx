import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';

interface Activity {
  readonly id: string;
  readonly who: string;
  readonly when: string;
  readonly what: string;
  readonly tone?: 'info' | 'success' | 'warning' | 'error';
}

const SEED: readonly Activity[] = [
  { id: 'n1', who: 'system', when: '2 min ago', what: 'New issue WEB-128 detected: TypeError on /dashboard', tone: 'error' },
  { id: 'n2', who: 'alice', when: '14 min ago', what: 'resolved API-203', tone: 'success' },
  { id: 'n3', who: 'system', when: '32 min ago', what: 'release web@2.14.3 promoted to production', tone: 'info' },
  { id: 'n4', who: 'bob', when: '1 hour ago', what: 'commented on WEB-99: "looks like a session expiry race"' },
  { id: 'n5', who: 'pagerduty', when: '2 hours ago', what: 'acknowledged incident on api.example.com', tone: 'warning' },
];

const TONE_DOT: Readonly<Record<NonNullable<Activity['tone']>, string>> = {
  info: 'bg-sr-accent',
  success: 'bg-sr-success',
  warning: 'bg-sr-warning',
  error: 'bg-sr-error',
};

export function NotificationsPanel(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const unread = seen ? 0 : SEED.length;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="notifications"
        data-testid="notifications-bell"
        onClick={() => {
          setOpen((o) => !o);
          setSeen(true);
        }}
        className="relative flex h-8 w-8 items-center justify-center rounded border border-sr-border bg-sr-bg text-sr-fg hover:bg-white/5"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span
            data-testid="notifications-badge"
            className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sr-error px-1 text-[10px] font-semibold text-white"
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="notifications panel"
          data-testid="notifications-panel"
          className="absolute right-0 top-10 z-30 w-80 overflow-hidden rounded-lg border border-sr-border bg-sr-panel shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-sr-border px-3 py-2">
            <span className="text-sm font-medium">Activity</span>
            <span className="text-xs text-sr-muted">{SEED.length} recent</span>
          </header>
          <ul className="max-h-80 overflow-y-auto">
            {SEED.map((a) => (
              <li key={a.id} className="flex items-start gap-2 border-b border-sr-border/40 px-3 py-2 last:border-0">
                <span className={['mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', a.tone ? TONE_DOT[a.tone] : 'bg-sr-muted'].join(' ')} />
                <Avatar name={a.who} size="xs" />
                <div className="flex-1 text-xs">
                  <div className="text-sr-fg">
                    <strong>{a.who}</strong> {a.what}
                  </div>
                  <div className="mt-0.5 text-sr-muted">{a.when}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}