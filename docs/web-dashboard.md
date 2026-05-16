# Web dashboard

Warden's web UI is a single-page React app built with React 19.2, Tailwind v4.3 (Oxide), and React Router 7, served as a static bundle. There are 17 routes covering the full product surface. Source: [`apps/web/src/`](../apps/web/src/).

## Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Sidebar  │  Header (env switcher, time range, search, ⌘K)     │
│           ├────────────────────────────────────────────────────┤
│  Core     │                                                    │
│  • Dashboard                                                   │
│  • Issues │                                                    │
│  • Perf   │            Active page renders here                │
│  • Traces │                                                    │
│  • Profiles                                                    │
│  • Discover                                                    │
│           │                                                    │
│  Monitor  │                                                    │
│  • Dashboards                                                  │
│  • Alerts │                                                    │
│  • Crons  │                                                    │
│  • Uptime │                                                    │
│           │                                                    │
│  Manage   │                                                    │
│  • Releases                                                    │
│  • Source maps                                                 │
│  • Saved searches                                              │
│  • SDK setup                                                   │
│  • Settings                                                    │
└────────────────────────────────────────────────────────────────┘
```

- **Sidebar** (`src/layout/Sidebar.tsx`): three groups, with the org name + project count footer.
- **Header** (`src/layout/Header.tsx`): environment switcher (production / staging / development / all), time-range picker (1h / 24h / 7d / 30d / 90d), command palette button (`⌘K`), quick-filter input, ingest health dot, notifications panel, help, "Invite teammate" CTA.

Global UI state lives in [`src/state/AppContext.tsx`](../apps/web/src/state/AppContext.tsx): selected environment, selected time range, command-palette open state, toasts.

## Theme

Dark only. Color tokens are CSS custom properties in [`src/styles.css`](../apps/web/src/styles.css):

```
--color-sr-bg:       #0b0d12   (background)
--color-sr-panel:    #12151c   (cards)
--color-sr-border:   #2a2f3a
--color-sr-fg:       #e8eaef   (text)
--color-sr-muted:    #8a92a3   (secondary)
--color-sr-accent:   #7c5cff   (primary)
--color-sr-success:  #4ade80
--color-sr-warning:  #fbbf24
--color-sr-error:    #f87171
--color-sr-fatal:    #be123c
```

Monospace font (JetBrains Mono / Fira Code). No light mode.

## Keyboard shortcuts

| Keys           | Action                                        |
| -------------- | --------------------------------------------- |
| `⌘K`           | Open command palette.                         |
| `?`            | Show shortcut help dialog.                    |
| `g d`          | Go to Dashboard.                              |
| `g i`          | Go to Issues.                                 |
| `g p`          | Go to Performance.                            |
| `g t`          | Go to Traces.                                 |
| `g a`          | Go to Alerts.                                 |
| `j` / `k`      | Move selection down / up in lists.            |
| `↵`            | Open selected row.                            |
| `e` / `i`      | Resolve / Ignore the focused issue.           |
| `Esc`          | Close modal or command palette.               |

Implemented in [`src/components/KeyboardShortcuts.tsx`](../apps/web/src/components/KeyboardShortcuts.tsx). The command palette ([`src/components/CommandPalette.tsx`](../apps/web/src/components/CommandPalette.tsx)) is a fuzzy-search command list — ~20 navigation and filter commands.

## Pages

### Dashboard — `/`

Top-of-funnel overview. Cards: Events/s, Errors/min, p95 latency, Sessions — each with a sparkline. Below: Events over time chart, Recent issues widget (top 5), Uptime check status grid.

### Issues — `/issues`

The issue (group) list.

- **Filters**: status (all/unresolved/resolved/ignored), level, project, search.
- **Sort**: Last seen, Events, Users affected.
- **Bulk actions**: resolve, ignore, archive.
- **Per row**: title (top frame + value), level badge, environment, project, last-seen sparkline, events count, users count.

Clicking a row opens **Issue detail** at `/issues/:id`.

### Issue detail — `/issues/:id`

- Breadcrumb back to list, title, culprit line.
- Action buttons: Resolve, Ignore, Archive, Assign to teammate.
- Status badges, level badge, last-seen / first-seen timestamps.
- Events-over-time chart.
- Tabs: **Stack trace** (most recent event), **Breadcrumbs**, **Tags**, **Activity** (assignment / status changes).

### Performance — `/performance`

Transaction overview.

- **Filters**: operation type (all/`http.server`/`queue.process`), search.
- **Sort**: p95, p99, throughput, failure rate, Apdex.
- **Charts**: Transactions per minute, p95 latency over time.
- **Per row**: operation, sparkline trend, p95, p99, TPM, failure %.

### Traces — `/traces`

Sortable trace list.

- Columns: root transaction, operation, HTTP status, span count, total duration (highlighted >1 s), user, start time.
- **Filters**: project, status (all/ok/error), search by transaction name or trace ID.

### Trace detail — `/traces/:id`

Three-column layout:

1. **Waterfall** — spans tree, time-aligned bars, click to select.
2. **Span detail panel** — selected span's op, description, duration, tags, attributes.
3. **Header strip** — root transaction, project, span count, total duration, status badge.

Breadcrumb back to the trace explorer.

### Profiles — `/profiles`

CPU profile list + flame graph viewer.

- Left: profile table (transaction, platform, project, samples, duration). Filter by platform.
- Right: flame graph for the selected profile.

### Discover — `/discover`

Ad-hoc query builder. Build a query from:

- **Filters**: clauses of `{key, operator, value}` (`tag.route = /checkout`, `level >= warning`, …).
- **Aggregates**: `count()`, `count_unique(user)`, `p50(duration)`, `p95(duration)`, `failure_rate()`, etc.
- **Group by**: any tag.
- **Time range**: from the header picker.

Results table updates live. Save the query as a Saved search.

### Dashboards — `/dashboards`

Custom dashboards. Sidebar lists dashboards; the active one shows a grid of widgets (line charts, big-number stats). Add or edit a widget via the modal: pick query, chart type, label, position.

### Alerts — `/alerts`

Alert-rule list.

- Columns: name, metric, threshold, evaluation window, project, channel, target, status (ok / firing / paused), last fired.
- Create a new rule via the modal: choose between Issue alerts (fires on new/regressed issues) and Metric alerts (fires on a query threshold).
- Edit any row via inline modal.

### Crons — `/crons`

Scheduled job monitors.

- Columns: slug, cron schedule, status badge (ok / error / missed / timeout / disabled / never-run), last run (duration), next expected run.
- Add a monitor with `{slug, schedule, tolerance_minutes}`. Then send `check_in` envelope items from your job.

### Uptime — `/uptime`

HTTP and TCP probes.

- Columns: name, target URL, status badge (up / degraded / down / unknown), 7-day uptime %, response time, last checked.
- Add a monitor with `{name, url, method, interval_seconds, expected_status}`.

### Releases — `/releases`

Release health.

- Columns: version (monospace), environments (badges), commit count, new issues (highlighted >0), crash-free % session rate, deployed at (relative time).
- Click a release to see commit list, new issues introduced, regression-resolved issues.

### Source maps — `/source-maps`

JavaScript source-map management.

- File list: filename, release, debug ID, file size, uploaded at.
- Upload area: drop `*.js.map` files; the UI extracts `debug_id` from each.
- Verify a debug ID: enter an ID to see whether the matching map is uploaded.

### Saved searches — `/saved-searches`

User-saved Discover / Issues queries.

- Per query: name, query text (monospace), target type (issues / discover / performance), pinned state, created date.
- Pin frequently used queries to the sidebar.

### SDK setup — `/sdk-setup`

A 4-step wizard for engineers integrating a new application:

1. **Platform** — choose JavaScript / Python / Rust / Go / Swift.
2. **Install** — copy the install command.
3. **DSN** — display the DSN for this project.
4. **Verify** — "Send a test event" button posts a sample message envelope to the relay and confirms receipt.

## Settings

### Organization settings — `/settings`

Tabs:

- **General** — org name and slug. Save button updates and emits an audit log entry.
- **Members** — invite, role management. Roles: `owner`, `manager`, `admin`, `member`, `billing`.
- **Teams** — group projects and members.
- **API tokens** — create with scopes (`org:read`, `org:admin`, `project:read`, `project:write`, `project:admin`, `event:read`, `event:write`, `event:admin`).
- **Projects** — list, create, archive.
- **Integrations** — Slack, GitHub, Jira, PagerDuty, OpsGenie. Enable/disable toggle plus per-integration credentials modal.
- **Audit log** — filterable by action, actor, target.
- **Danger zone** — delete org (gated by typed confirmation).

### Project settings — `/settings/projects/:slug`

Tabs:

- **General** — project name, platform.
- **Client keys** — DSN. Reveal, copy, rotate, create additional keys (e.g. per-environment).
- **PII scrubbing** — toggle built-in rules (email, phone, SSN, JWT, bearer tokens, cloud secrets), add custom regex patterns.
- **Rate limits** — burst capacity and refill rate per data category. See [API: rate limits](./api/rate-limits.md).

## Data sources today

The current build renders against deterministic mock data in `src/data/*.ts` so every page is reviewable end-to-end. The read-side HTTP API that backs these pages with live data is in progress; once wired, every list, chart, and detail page consumes JSON from `GET /api/{org}/projects/{project}/...` with `Authorization: Bearer <token>`.

## Where to read next

- [Reporting guide](./reporting-guide.md) — how to send data the dashboard surfaces.
- [API: envelope](./api/envelope.md) — the wire format that produces the data shown here.
