import type { JSX } from 'react';
import { NavLink } from 'react-router';

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: string;
}

interface NavGroup {
  readonly heading?: string;
  readonly items: readonly NavItem[];
}

const NAV: readonly NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: '⌂' },
      { to: '/issues', label: 'Issues', icon: '⚠' },
      { to: '/performance', label: 'Performance', icon: '↘' },
      { to: '/traces', label: 'Traces', icon: '⇢' },
      { to: '/profiles', label: 'Profiles', icon: '◭' },
      { to: '/discover', label: 'Discover', icon: '⌕' },
    ],
  },
  {
    heading: 'Monitor',
    items: [
      { to: '/dashboards', label: 'Dashboards', icon: '▦' },
      { to: '/alerts', label: 'Alerts', icon: '⌜' },
      { to: '/crons', label: 'Crons', icon: '⏱' },
      { to: '/uptime', label: 'Uptime', icon: '◉' },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { to: '/releases', label: 'Releases', icon: '⤴' },
      { to: '/source-maps', label: 'Source Maps', icon: '⌬' },
      { to: '/saved-searches', label: 'Saved Searches', icon: '★' },
      { to: '/sdk-setup', label: 'SDK Setup', icon: '◳' },
      { to: '/settings', label: 'Settings', icon: '⚙' },
    ],
  },
];

export function Sidebar(): JSX.Element {
  return (
    <aside className="flex w-56 flex-col border-r border-sr-border bg-sr-panel">
      <div className="flex items-center gap-2 border-b border-sr-border px-6 py-5">
        <div className="h-6 w-6 rounded bg-sr-accent" />
        <span className="text-base font-semibold tracking-tight">sentry-replica</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((group, gi) => (
          <div key={gi} className={gi === 0 ? '' : 'mt-3 border-t border-sr-border/60 pt-3'}>
            {group.heading && (
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-sr-muted">
                {group.heading}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    data-testid={`nav-${navTestId(item.label)}`}
                    className={({ isActive }) =>
                      [
                        'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-sr-accent/15 text-sr-fg'
                          : 'text-sr-muted hover:bg-white/5 hover:text-sr-fg',
                      ].join(' ')
                    }
                  >
                    <span aria-hidden className="w-4 text-center text-base">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-sr-border px-4 py-3 text-xs text-sr-muted">
        Connected · 1 org · 5 projects
      </div>
    </aside>
  );
}

function navTestId(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-');
}