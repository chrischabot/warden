# UI end-to-end journeys

18 Playwright + Chromium journeys against the running Vite dev server. Each performs ≥8 distinct user interactions (most do 10–13), asserts page state at every meaningful step, captures a screenshot, and treats any unfiltered console error / warning as a hard failure.

## Run

In one terminal, start the dev server (binds to `http://0.0.0.0:8080`):

```bash
bun run --filter=@sr/app-web dev
```

In another, run the journey suite:

```bash
bun run --filter=@sr/app-web e2e:ui
```

Or directly, with optional flags:

```bash
bun apps/web/test-e2e/journeys.ts [--base=URL] [--only=NAME]
```

The runner exits **non-zero** if any journey fails an assertion or surfaces an unfiltered console error/warning. Screenshots land in `screenshots/` (gitignored).

## Coverage

| # | Journey | What it exercises |
|--:|---------|-------------------|
| 1 | `triage_and_resolve` | search + level + project + sort filters on Issues, drill-down, tab through Stack/Breadcrumbs/Tags, click Resolve, verify toast |
| 2 | `performance_drilldown` | time-range change, op chip toggle, search, sort by failure rate, palette nav out |
| 3 | `create_alert` | 7-field create-alert modal (name/project/metric/threshold/window/channel/target), row count grows by 1, pause new rule |
| 4 | `configure_ingestion` | per-project settings tabs; reveal/copy/rotate DSN with confirm modal; save rate-limit values |
| 5 | `discover_query` | Discover: type query, toggle aggregates, add filter, change group-by, run, save with name |
| 6 | `release_navigation` | sidebar + command-palette navigation across Releases, Uptime, Crons, Performance, Dashboard |
| 7 | `manage_members` | invite member modal, role-change select, switch through API Tokens / Teams / Integrations tabs |
| 8 | `cron_uptime_env_switch` | Crons + Uptime + Releases nav; palette-driven env+range changes; verify the env/range selects update |
| 9 | `build_dashboard` | switch dashboards, add widget, create new dashboard, add a second widget to the new dashboard |
| 10 | `command_palette` | Cmd-K opens; navigate, change env + range, fuzzy "perf" match, empty-state, Esc closes, state resets on reopen |
| 11 | `bulk_actions_audit` | select-all + bulk archive, manual two-row select + bulk resolve, Audit Log filter narrows and clears |
| 12 | `settings_save_flow` | org rename + save, Integrations + Projects tabs, Danger Zone delete modal cancel and confirm, name persistence |
| 13 | `trace_exploration` | filter traces by search/status/project, drill into a trace, inspect 12-span waterfall, select spans, breadcrumb back |
| 14 | `profile_flamegraph` | open profiles, switch active profile, filter by platform, hover a flame frame to surface self/total time |
| 15 | `sdk_setup_wizard` | 4-step wizard: select platform, advance through steps, edit DSN, send test event, walk back, switch platform |
| 16 | `source_maps_upload_verify` | upload a source map (row count grows), verify a known debug id (match toast), verify unknown id (miss toast), remove a row |
| 17 | `saved_searches_crud` | create a saved search via modal, pin it, verify the run-link target, delete it |
| 18 | `notifications_and_shortcuts` | open the notifications bell panel, outside-click close, open shortcuts modal via help button + ? key, close via Esc + X |

## Acceptance gates

Each journey must:

1. Reach the final assertion of its run function without throwing.
2. Capture no unfiltered console errors or warnings.

Filtered noise: Vite HMR connecting/connected messages and the React DevTools info log. Everything else fails the journey.

## Latest results

18/18 journeys passing — see the final run output for per-journey step counts and elapsed time.