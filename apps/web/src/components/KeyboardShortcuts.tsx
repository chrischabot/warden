import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Modal } from './Modal';

const SHORTCUTS: ReadonlyArray<{ readonly keys: readonly string[]; readonly description: string }> = [
  { keys: ['⌘', 'K'], description: 'Open command palette' },
  { keys: ['?'], description: 'Show keyboard shortcuts (this dialog)' },
  { keys: ['g', 'd'], description: 'Go to dashboard' },
  { keys: ['g', 'i'], description: 'Go to issues' },
  { keys: ['g', 'p'], description: 'Go to performance' },
  { keys: ['g', 't'], description: 'Go to traces' },
  { keys: ['g', 'a'], description: 'Go to alerts' },
  { keys: ['j', 'k'], description: 'Move selection up / down in lists' },
  { keys: ['↵'], description: 'Open selected row' },
  { keys: ['e'], description: 'Resolve focused issue' },
  { keys: ['i'], description: 'Ignore focused issue' },
  { keys: ['Esc'], description: 'Close modal / palette' },
];

/** Programmatic open: dispatch a CustomEvent('sr:open-shortcuts'). */
export function openShortcuts(): void {
  document.dispatchEvent(new CustomEvent('sr:open-shortcuts'));
}

export function KeyboardShortcutsModal(): JSX.Element {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
      }
    }
    function onOpen(): void {
      setOpen(true);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('sr:open-shortcuts', onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('sr:open-shortcuts', onOpen);
    };
  }, []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="shortcuts-list">
        {SHORTCUTS.map((s) => (
          <li key={s.description} className="flex items-center justify-between gap-3 rounded border border-sr-border/60 px-3 py-1.5 text-sm">
            <span className="text-sr-muted">{s.description}</span>
            <span className="flex items-center gap-1">
              {s.keys.map((k) => (
                <kbd key={k} className="rounded border border-sr-border bg-sr-bg px-1.5 py-0.5 text-[11px] text-sr-fg">
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}