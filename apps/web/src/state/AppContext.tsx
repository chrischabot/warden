import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type Environment = 'production' | 'staging' | 'development' | 'all';
export type TimeRange = '1h' | '24h' | '7d' | '30d' | '90d';

export interface Toast {
  readonly id: string;
  readonly tone: 'info' | 'success' | 'warning' | 'error';
  readonly title: string;
  readonly body?: string;
}

interface AppState {
  readonly environment: Environment;
  readonly timeRange: TimeRange;
  readonly toasts: readonly Toast[];
  readonly paletteOpen: boolean;
  setEnvironment(env: Environment): void;
  setTimeRange(range: TimeRange): void;
  pushToast(toast: Omit<Toast, 'id'>): void;
  dismissToast(id: string): void;
  openPalette(): void;
  closePalette(): void;
  togglePalette(): void;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [environment, setEnvironment] = useState<Environment>('production');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full: Toast = { id, ...toast };
    setToasts((prev) => [...prev, full]);
    // Auto-dismiss after 4 seconds.
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const togglePalette = useCallback(() => setPaletteOpen((p) => !p), []);

  const value = useMemo<AppState>(
    () => ({
      environment,
      timeRange,
      toasts,
      paletteOpen,
      setEnvironment,
      setTimeRange,
      pushToast,
      dismissToast,
      openPalette,
      closePalette,
      togglePalette,
    }),
    [environment, timeRange, toasts, paletteOpen, pushToast, dismissToast, openPalette, closePalette, togglePalette],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}