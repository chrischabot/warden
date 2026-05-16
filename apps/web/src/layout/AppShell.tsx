import type { JSX, ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-sr-bg px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
