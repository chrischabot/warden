/**
 * UI end-to-end journeys, driven by Playwright + Chromium against the
 * running Vite dev server. Each journey performs at least 10 user
 * interactions, asserts page state at each meaningful step, captures
 * a final screenshot, and records console errors.
 *
 * Run:
 *
 *   bun apps/web/test-e2e/journeys.ts [--base=URL] [--only=NAME]
 *
 * Defaults to http://localhost:8080. Exits non-zero if any journey
 * fails an assertion or surfaces an unexpected console error.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Browser, BrowserContext, ConsoleMessage, Page } from 'playwright';
import { chromium } from 'playwright';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const SCREENSHOTS_DIR = path.join(SCRIPT_DIR, 'screenshots');

interface JourneyContext {
  readonly page: Page;
  readonly base: string;
  readonly errors: string[];
  readonly logs: string[];
  /** Increment for every distinct user-style interaction so steps reflect reality. */
  step(label?: string): void;
}

interface JourneyResult {
  readonly name: string;
  readonly description: string;
  readonly ok: boolean;
  readonly failure?: string;
  readonly steps: number;
  readonly elapsedMs: number;
  readonly consoleErrors: readonly string[];
  readonly screenshot?: string;
}

interface JourneySpec {
  readonly name: string;
  readonly description: string;
  run(ctx: JourneyContext): Promise<void>;
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionError(message);
}

async function expectVisible(page: Page, selector: string, label: string): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {
    throw new AssertionError(`expected visible: ${label} (selector="${selector}")`);
  });
}

async function expectText(page: Page, selector: string, needle: string | RegExp): Promise<void> {
  // Wait until the element has the text or timeout.
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  const deadline = Date.now() + 3000;
  let text = '';
  while (Date.now() < deadline) {
    text = (await loc.textContent()) ?? '';
    if (typeof needle === 'string' ? text.includes(needle) : needle.test(text)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  const needleStr = needle instanceof RegExp ? needle.source : needle;
  throw new AssertionError(`expected "${needleStr}" in "${text}" (selector="${selector}")`);
}

async function expectUrl(page: Page, pattern: RegExp): Promise<void> {
  await page.waitForURL(pattern, { timeout: 4000 }).catch(() => {
    throw new AssertionError(`expected URL to match ${pattern}, got ${page.url()}`);
  });
}

async function expectToast(page: Page, fragment: string): Promise<void> {
  // Match a toast whose text contains the fragment, anywhere in the stack.
  const selector = `[role="status"] [data-testid^="toast-"]:has-text("${fragment}")`;
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 3000 }).catch(async () => {
    const allToasts = await page
      .locator('[role="status"] [data-testid^="toast-"]')
      .allTextContents();
    throw new AssertionError(
      `expected a toast containing "${fragment}". Current toasts: [${allToasts.map((t) => `"${t.replace(/\s+/g, ' ').trim()}"`).join(', ')}]`,
    );
  });
}

/** Wait for table rows to render before counting. */
async function waitForRows(page: Page, minRows = 1): Promise<number> {
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  // Settle on a stable count.
  let prev = -1;
  for (let i = 0; i < 8; i++) {
    const c = await page.locator('table tbody tr').count();
    if (c === prev && c >= minRows) return c;
    prev = c;
    await new Promise((r) => setTimeout(r, 50));
  }
  return prev;
}

async function waitFor(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function navTo(page: Page, testid: string, urlPattern: RegExp, expectedH1?: string): Promise<void> {
  await page.click(`[data-testid="${testid}"]`);
  await expectUrl(page, urlPattern);
  if (expectedH1) await expectText(page, 'h1', expectedH1);
}

async function openPalette(page: Page): Promise<void> {
  // Ensure body has focus so the document keydown handler fires.
  await page.locator('body').click({ force: true });
  await waitFor(80);
  await page.keyboard.press('Control+K');
  await expectVisible(page, '[aria-label="command palette"]', 'command palette');
}

// ----- Journey definitions ----------------------------------------------

const journeys: readonly JourneySpec[] = [
  // ---- 1. Triage and resolve a TypeError ----
  {
    name: 'triage_and_resolve',
    description: 'Triage a TypeError: search, filter level+project, sort, drill-down, tab through, resolve',
    async run({ page, base, step }) {
      await page.goto(`${base}/`);
      await expectText(page, 'h1', 'Overview');
      step('load dashboard');

      await navTo(page, 'nav-issues', /\/issues/, 'Issues');
      step('navigate to issues');

      await page.fill('[data-testid="issues-search"]', 'TypeError');
      step('type search');

      await page.selectOption('[data-testid="filter-level"]', 'error');
      step('filter by level=error');

      await page.selectOption('[data-testid="filter-project"]', 'web');
      step('filter by project=web');

      await page.selectOption('[data-testid="sort-key"]', 'eventsCount');
      step('change sort key');

      await page.click('[data-testid="sort-dir"]');
      step('flip sort direction');

      const rowCount = await waitForRows(page, 1);
      assert(rowCount >= 1, `expected ≥1 issue row after filter, got ${rowCount}`);
      step(`verified ${rowCount} row(s) match filters`);

      await page.locator('table tbody tr').first().click();
      await expectUrl(page, /\/issues\/g\d+/);
      step('click first issue row');

      await page.click('button[role="tab"]:has-text("Breadcrumbs")');
      await expectVisible(page, '[role="tabpanel"]', 'breadcrumbs panel');
      step('switch to Breadcrumbs tab');

      await page.click('button[role="tab"]:has-text("Tags")');
      await expectText(page, '[role="tabpanel"]', 'environment');
      step('switch to Tags tab');

      await page.click('[data-testid="resolve-issue"]');
      await expectToast(page, 'Resolved');
      step('click Resolve and verify toast');
    },
  },

  // ---- 2. Performance investigation ----
  {
    name: 'performance_drilldown',
    description: 'Performance: time-range, op chip, search, sort by failure rate, palette nav',
    async run({ page, base, step }) {
      await page.goto(`${base}/`);
      step('load dashboard');

      await navTo(page, 'nav-performance', /\/performance/, 'Performance');
      step('navigate to performance');

      await page.selectOption('select[aria-label="time range"]', '7d');
      step('change time range to 7d');

      await page.click('[data-testid="op-http.server"]');
      const httpServerPressed = await page
        .locator('[data-testid="op-http.server"]')
        .getAttribute('aria-pressed');
      assert(httpServerPressed === 'true', 'http.server chip should be pressed');
      step('select op chip http.server');

      await page.fill('[data-testid="perf-search"]', 'orders');
      step('search transactions');

      await page.selectOption('[data-testid="perf-sort"]', 'failureRate');
      step('sort by failure rate');

      await page.click('[data-testid="perf-sort-dir"]');
      step('flip sort direction');

      const rowsAfterFilter = await waitForRows(page, 1);
      assert(rowsAfterFilter >= 1, 'expected ≥1 row after filter+search');
      step(`verified ${rowsAfterFilter} row(s)`);

      await page.click('[data-testid="op-all"]');
      step('clear op filter');

      await page.fill('[data-testid="perf-search"]', '');
      step('clear search');

      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', 'dashboard');
      await page.keyboard.press('Enter');
      await expectUrl(page, /^[^?]*\/(\?.*)?$/);
      step('navigate via palette to dashboard');
    },
  },

  // ---- 3. Create alert ----
  {
    name: 'create_alert',
    description: 'Open create-alert modal, fill 7 fields, save, then pause new rule',
    async run({ page, base, step }) {
      await page.goto(`${base}/alerts`);
      step('load alerts page');

      await expectText(page, 'h1', 'Alerts');
      const before = await waitForRows(page, 1);
      step(`baseline: ${before} alert(s)`);

      await page.click('[data-testid="create-alert"]');
      await expectVisible(page, 'h3:has-text("Create alert")', 'create-alert modal');
      step('open create modal');

      await page.fill('input[aria-label="alert name"]', 'API p95 spike');
      step('fill name');
      await page.selectOption('select[aria-label="alert project"]', 'api');
      step('select project=api');
      await page.selectOption('select[aria-label="alert metric"]', 'p95(transaction.duration)');
      step('select metric=p95');
      await page.fill('input[aria-label="alert threshold"]', '1500');
      step('fill threshold');
      await page.selectOption('select[aria-label="alert window"]', '10 min');
      step('select window=10min');
      await page.selectOption('select[aria-label="alert channel"]', 'pagerduty');
      step('select channel=pagerduty');
      await page.fill('input[aria-label="alert target"]', 'oncall-rotation');
      step('fill target');

      await page.click('[data-testid="create-alert-confirm"]');
      await expectToast(page, 'API p95 spike');
      step('save and verify toast');

      const after = await waitForRows(page, before + 1);
      assert(after === before + 1, `expected ${before + 1} rows after create, got ${after}`);
      step(`verified ${after} rules in table`);

      // Pause the new alert (which is at the top).
      const pauseBtn = page.locator('table tbody tr').first().locator('button:has-text("Pause")');
      await pauseBtn.click();
      await expectToast(page, 'Paused');
      step('pause new alert and verify toast');
    },
  },

  // ---- 4. Configure ingestion ----
  {
    name: 'configure_ingestion',
    description: 'Project DSN reveal+copy+rotate, scrubbing tab, rate-limit save',
    async run({ page, base, step }) {
      await page.goto(`${base}/settings`);
      step('load settings');

      await page.click('button[role="tab"]:has-text("Projects")');
      step('open Projects tab');

      await page.click('[data-testid="project-web"]');
      await expectUrl(page, /\/settings\/projects\/web/);
      step('drill into web project');

      await page.click('button[role="tab"]:has-text("Client Keys")');
      await expectVisible(page, '[data-testid="reveal-key-k1"]', 'reveal button');
      step('open Client Keys tab');

      await page.click('[data-testid="reveal-key-k1"]');
      const codeText = (await page.locator('code').first().textContent()) ?? '';
      assert(codeText.includes('https://') && !codeText.includes('•'), 'DSN should be revealed');
      step('reveal DSN');

      await page.click('[data-testid="copy-key-k1"]');
      await expectToast(page, 'copied');
      step('copy DSN and verify toast');

      const dsnBefore = (await page.locator('code').first().textContent()) ?? '';

      await page.click('[data-testid="rotate-key-k1"]');
      await expectVisible(page, 'h3:has-text("Rotate")', 'rotate modal');
      step('open rotate modal');

      await page.click('[data-testid="rotate-key-confirm"]');
      await expectToast(page, 'rotated');
      step('confirm rotate and verify toast');

      const dsnAfter = (await page.locator('code').first().textContent()) ?? '';
      assert(dsnAfter !== dsnBefore, 'DSN should change after rotate');
      step('DSN value updated');

      await page.click('button[role="tab"]:has-text("Data Scrubbing")');
      await expectVisible(page, 'input[aria-label="scrub built-in patterns"]', 'scrubbing toggle');
      step('open Data Scrubbing tab');

      await page.click('button[role="tab"]:has-text("Rate Limits")');
      await page.fill('input[aria-label="rate capacity"]', '20000');
      await page.fill('input[aria-label="rate refill"]', '2000');
      step('edit rate limit values');

      await page.click('[data-testid="save-limits"]');
      await expectToast(page, 'Rate limits');
      step('save limits and verify toast');
    },
  },

  // ---- 5. Discover query ----
  {
    name: 'discover_query',
    description: 'Build Discover query: toggle aggregates, add filter, change group, run, save',
    async run({ page, base, step }) {
      await page.goto(`${base}/discover`);
      step('load discover');

      await expectText(page, 'h1', 'Discover');
      await page.fill('input[aria-label="discover query"]', 'level:error environment:production');
      step('type query text');

      await page.click('button:has-text("p99(duration)")');
      const p99Pressed = await page
        .locator('button:has-text("p99(duration)")')
        .getAttribute('aria-pressed');
      assert(p99Pressed === 'true', 'p99 aggregate chip should be pressed');
      step('toggle p99 aggregate');

      await page.click('button:has-text("count")');
      step('toggle count aggregate off');

      await page.click('[data-testid="add-filter"]');
      const filterCount = await page.locator('[aria-label^="filter-"][aria-label$="-field"]').count();
      assert(filterCount === 2, `expected 2 filters after add, got ${filterCount}`);
      step('add filter');

      const lastFilter = filterCount - 1;
      await page.selectOption(`select[aria-label="filter-${lastFilter}-field"]`, 'release');
      await page.selectOption(`select[aria-label="filter-${lastFilter}-op"]`, '!=');
      await page.fill(`input[aria-label="filter-${lastFilter}-value"]`, 'web@2.14.3');
      step('configure new filter');

      await page.selectOption('select[aria-label="group by"]', 'release');
      step('change group-by to release');

      await page.click('[data-testid="run-query"]');
      await expectToast(page, 'Query executed');
      step('run query and verify toast');

      await page.click('[data-testid="save-query"]');
      await expectVisible(page, 'h3:has-text("Save query")', 'save modal');
      step('open save query modal');

      await page.fill('input[aria-label="saved query name"]', 'Top errors by release');
      await page.click('[data-testid="save-query-confirm"]');
      await expectToast(page, 'Top errors by release');
      step('save query and verify toast');
    },
  },

  // ---- 6. Release navigation ----
  {
    name: 'release_navigation',
    description: 'Navigate releases via sidebar, command palette, and back',
    async run({ page, base, step }) {
      await page.goto(`${base}/`);
      step('load dashboard');

      await navTo(page, 'nav-releases', /\/releases/, 'Releases');
      step('navigate to releases');

      const releases = await waitForRows(page, 2);
      assert(releases >= 2, `expected ≥2 release rows, got ${releases}`);
      step(`verified ${releases} release(s)`);

      await navTo(page, 'nav-dashboard', /^[^?]*\/(\?.*)?$/, 'Overview');
      step('navigate back to dashboard');

      await openPalette(page);
      step('open palette');

      await page.fill('[aria-label="command palette search"]', 'release');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expectUrl(page, /\/releases/);
      step('navigate to releases via palette');

      await navTo(page, 'nav-uptime', /\/uptime/, 'Uptime');
      const uptimeRows = await waitForRows(page, 1);
      assert(uptimeRows >= 1, 'uptime page should have rows');
      step(`uptime has ${uptimeRows} row(s)`);

      await navTo(page, 'nav-crons', /\/crons/, 'Crons');
      step('navigate to crons');

      await navTo(page, 'nav-performance', /\/performance/, 'Performance');
      step('navigate to performance');

      await navTo(page, 'nav-releases', /\/releases/, 'Releases');
      step('back to releases');
    },
  },

  // ---- 7. Manage members ----
  {
    name: 'manage_members',
    description: 'Invite, change role, switch through API tokens / teams / integrations tabs',
    async run({ page, base, step }) {
      await page.goto(`${base}/settings`);
      step('load settings');

      await page.click('button[role="tab"]:has-text("Members")');
      const before = await waitForRows(page, 4);
      assert(before >= 4, `expected ≥4 seed members, got ${before}`);
      step(`baseline: ${before} members`);

      await page.click('[data-testid="invite-member"]');
      await expectVisible(page, 'h3:has-text("Invite member")', 'invite modal');
      step('open invite modal');

      await page.fill('input[aria-label="invite email"]', 'newperson@acme.com');
      await page.selectOption('select[aria-label="invite role"]', 'manager');
      step('fill invite form');

      await page.click('[data-testid="invite-send"]');
      await expectToast(page, 'newperson@acme.com');
      step('send invite and verify toast');

      const after = await waitForRows(page, before + 1);
      assert(after === before + 1, `expected ${before + 1} rows after invite, got ${after}`);
      step(`verified ${after} members`);

      // Change role of the first member.
      const firstSelect = page.locator('select[aria-label^="role for"]').first();
      await firstSelect.selectOption('manager');
      await expectToast(page, 'Role updated');
      step('change role and verify toast');

      await page.click('button[role="tab"]:has-text("API Tokens")');
      const tokens = await page.locator('main li').count();
      assert(tokens >= 1, 'should show ≥1 API token');
      step(`API tokens tab shows ${tokens} token(s)`);

      await page.click('button[role="tab"]:has-text("Teams")');
      const teams = await page.locator('main li').count();
      assert(teams >= 1, 'should show ≥1 team');
      step(`Teams tab shows ${teams} team(s)`);

      await page.click('button[role="tab"]:has-text("Integrations")');
      await expectText(page, 'main', 'Slack');
      step('Integrations tab loaded');
    },
  },

  // ---- 8. Cron + uptime env switch ----
  {
    name: 'cron_uptime_env_switch',
    description: 'Cron+uptime browsing with env and time-range switches via palette',
    async run({ page, base, step }) {
      await page.goto(`${base}/`);
      step('load dashboard');

      await navTo(page, 'nav-crons', /\/crons/, 'Crons');
      const cronRows = await waitForRows(page, 1);
      assert(cronRows >= 1, 'cron page should have rows');
      step(`crons has ${cronRows} monitor(s)`);

      await navTo(page, 'nav-uptime', /\/uptime/, 'Uptime');
      step('navigate to uptime');

      await navTo(page, 'nav-releases', /\/releases/, 'Releases');
      step('navigate to releases');

      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', 'crons');
      await page.keyboard.press('Enter');
      await expectUrl(page, /\/crons/);
      step('navigate to crons via palette');

      // Change env via palette.
      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', 'staging');
      await page.keyboard.press('Enter');
      await expectToast(page, 'staging');
      const envValue = await page.locator('select[aria-label="environment"]').inputValue();
      assert(envValue === 'staging', `expected env=staging, got ${envValue}`);
      step('env switched to staging');

      // Change time range via palette.
      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', '7 days');
      await page.keyboard.press('Enter');
      await expectToast(page, '7 days');
      const tr = await page.locator('select[aria-label="time range"]').inputValue();
      assert(tr === '7d', `expected timeRange=7d, got ${tr}`);
      step('time range set to 7d');

      await page.selectOption('select[aria-label="environment"]', 'production');
      step('reset env to production');

      await navTo(page, 'nav-uptime', /\/uptime/, 'Uptime');
      const uptimeRows = await waitForRows(page, 1);
      assert(uptimeRows >= 1, 'uptime page should have rows');
      step(`uptime has ${uptimeRows} check(s)`);
    },
  },

  // ---- 9. Build dashboard ----
  {
    name: 'build_dashboard',
    description: 'Switch dashboards, add widget, create new dashboard with first widget',
    async run({ page, base, step }) {
      await page.goto(`${base}/dashboards`);
      await expectText(page, 'h1', 'Dashboards');
      step('load dashboards');

      await page.click('[data-testid="dashboard-tab-d2"]');
      await expectText(page, 'main', 'Backend p95s');
      step('switch to Backend p95s dashboard');

      await page.click('[data-testid="add-widget"]');
      await expectVisible(page, 'h3:has-text("Add widget")', 'add widget modal');
      step('open add widget modal');

      await page.fill('input[aria-label="widget title"]', 'Error rate by env');
      await page.selectOption('select[aria-label="widget type"]', 'big_number');
      await page.fill('input[aria-label="widget metric"]', 'failure_rate()');
      step('fill widget form');

      await page.click('[data-testid="add-widget-confirm"]');
      await expectToast(page, 'Error rate by env');
      step('add widget and verify toast');

      await expectText(page, 'main', 'Error rate by env');
      step('widget appears in dashboard');

      await page.click('[data-testid="dashboard-tab-d1"]');
      await expectText(page, 'main', 'Apdex');
      step('switch back to first dashboard');

      await page.click('[data-testid="new-dashboard"]');
      await page.fill('input[aria-label="dashboard name"]', 'API perf v2');
      await page.click('[data-testid="new-dashboard-confirm"]');
      await expectToast(page, 'API perf v2');
      step('create new dashboard and verify toast');

      await expectText(page, 'main', 'No widgets yet');
      step('new dashboard active and empty');

      await page.click('[data-testid="add-widget"]');
      await page.fill('input[aria-label="widget title"]', 'p95 by route');
      await page.selectOption('select[aria-label="widget type"]', 'line');
      await page.fill('input[aria-label="widget metric"]', 'p95(duration) by route');
      await page.click('[data-testid="add-widget-confirm"]');
      await expectToast(page, 'p95 by route');
      step('add widget to new dashboard');
    },
  },

  // ---- 10. Command palette ----
  {
    name: 'command_palette',
    description: 'Cmd-K navigation, env/range changes, fuzzy match, Esc close',
    async run({ page, base, step }) {
      await page.goto(`${base}/`);
      await expectText(page, 'h1', 'Overview');
      step('load dashboard');

      await openPalette(page);
      step('open palette (1)');

      await page.fill('[aria-label="command palette search"]', 'discover');
      await page.keyboard.press('Enter');
      await expectUrl(page, /\/discover/);
      step('navigate to discover');

      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', '7 days');
      await page.keyboard.press('Enter');
      await expectToast(page, '7 days');
      step('time range to 7 days');

      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', 'alerts');
      await page.keyboard.press('Enter');
      await expectUrl(page, /\/alerts/);
      step('navigate to alerts');

      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', 'staging');
      await page.keyboard.press('Enter');
      await expectToast(page, 'staging');
      step('env to staging');

      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', 'perf');
      const results = await page.locator('[role="option"]').count();
      assert(results >= 1, `expected ≥1 result for 'perf', got ${results}`);
      step(`palette shows ${results} results for "perf"`);

      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expectUrl(page, /\/performance/);
      step('navigate via ArrowDown+Enter');

      await openPalette(page);
      await page.fill('[aria-label="command palette search"]', 'xxx_nonexistent_yyy');
      await expectText(page, '[role="listbox"]', 'No matching commands');
      step('palette shows empty state for nonsense query');

      await page.keyboard.press('Escape');
      await waitFor(150);
      const stillOpen = await page.locator('[aria-label="command palette"]').count();
      assert(stillOpen === 0, 'palette should close on Escape');
      step('Esc closes palette');

      await openPalette(page);
      const searchValue = await page.locator('[aria-label="command palette search"]').inputValue();
      assert(searchValue === '', `palette search should reset on reopen, got "${searchValue}"`);
      step('palette reset on reopen');
    },
  },

  // ---- 11. Bulk actions + audit log ----
  {
    name: 'bulk_actions_audit',
    description: 'Select-all bulk archive, individual bulk resolve, audit-log filter',
    async run({ page, base, step }) {
      await page.goto(`${base}/issues`);
      step('load issues');

      await page.click('button:has-text("All")');
      step('switch to All filter');

      const baseRows = await waitForRows(page, 1);

      await page.click('input[aria-label="select all issues"]');
      await expectVisible(page, '[data-testid="bulk-actions"]', 'bulk actions bar');
      const selectedText = (await page.locator('[data-testid="bulk-actions"]').textContent()) ?? '';
      assert(/\d+ selected/.test(selectedText), `expected "N selected", got "${selectedText}"`);
      step(`select-all: ${selectedText.trim()}`);

      await page.click('[data-testid="bulk-archive"]');
      await expectToast(page, 'Archived');
      step('bulk-archive and verify toast');

      const stillBulk = await page.locator('[data-testid="bulk-actions"]').count();
      assert(stillBulk === 0, 'bulk-actions bar should disappear after action');
      step('selection cleared');

      // Wait for any previous toasts to dismiss before next assertion.
      await waitFor(4200);

      // Select two rows individually.
      const totalChecks = await page.locator('table tbody input[aria-label^="select "]').count();
      assert(totalChecks >= 2 || baseRows >= 2, `expected ≥2 issues to checkbox, got ${totalChecks}`);
      const targetCount = Math.min(2, totalChecks);
      for (let i = 0; i < targetCount; i++) {
        await page.locator('table tbody input[aria-label^="select "]').nth(i).click();
      }
      step(`selected ${targetCount} individual rows`);

      const newSelected = (await page.locator('[data-testid="bulk-actions"]').textContent()) ?? '';
      assert(
        newSelected.includes(`${targetCount} selected`),
        `expected "${targetCount} selected", got "${newSelected}"`,
      );
      step('bulk bar reflects manual selection');

      await page.click('[data-testid="bulk-resolve"]');
      await expectToast(page, 'Resolved');
      step('bulk-resolve and verify toast');

      await page.goto(`${base}/settings`);
      await page.click('button[role="tab"]:has-text("Audit Log")');
      await expectVisible(page, '[data-testid="audit-filter"]', 'audit filter');
      step('open Audit Log tab');

      const allAudit = await page.locator('main li').count();
      assert(allAudit >= 1, 'audit log should have entries');
      step(`audit log shows ${allAudit} entries`);

      await page.fill('[data-testid="audit-filter"]', 'alice');
      await waitFor(120);
      const filteredAudit = await page.locator('main li').count();
      assert(
        filteredAudit >= 1 && filteredAudit <= allAudit,
        `filter should narrow audit log, got ${filteredAudit}/${allAudit}`,
      );
      step(`filter narrows to ${filteredAudit}`);

      await page.fill('[data-testid="audit-filter"]', '');
      await waitFor(120);
      const restoredAudit = await page.locator('main li').count();
      assert(restoredAudit === allAudit, 'clearing filter should restore audit log');
      step('clear filter restores list');
    },
  },

  // ---- 12. Settings save flow ----
  {
    name: 'settings_save_flow',
    description: 'Org rename, integrations + projects tabs, danger-zone delete with cancel and confirm',
    async run({ page, base, step }) {
      await page.goto(`${base}/settings`);
      step('load settings');

      await expectVisible(page, 'input[aria-label="org name"]', 'org name input');
      const originalName = await page.locator('input[aria-label="org name"]').inputValue();
      assert(originalName === 'acme', `expected default name "acme", got "${originalName}"`);
      step('General tab loaded');

      await page.fill('input[aria-label="org name"]', 'acme corp');
      await page.fill('input[aria-label="org slug"]', 'acme-corp');
      step('edit org fields');

      await page.click('[data-testid="save-org"]');
      await expectToast(page, 'Organisation');
      step('save org and verify toast');

      await page.click('button[role="tab"]:has-text("Integrations")');
      const integrations = await page.locator('main li').count();
      assert(integrations >= 4, `expected ≥4 integrations, got ${integrations}`);
      step(`Integrations tab shows ${integrations}`);

      await page.click('button[role="tab"]:has-text("Projects")');
      const projects = await page.locator('main li').count();
      assert(projects >= 3, `expected ≥3 projects, got ${projects}`);
      step(`Projects tab shows ${projects}`);

      await page.click('button[role="tab"]:has-text("Danger Zone")');
      await expectVisible(page, '[data-testid="delete-org"]', 'delete-org button');
      step('Danger Zone tab loaded');

      await page.click('[data-testid="delete-org"]');
      await expectVisible(page, 'h3:has-text("Delete organisation")', 'delete modal');
      step('open delete modal');

      await page.click('button:has-text("Cancel")');
      await waitFor(150);
      const modalOpen = await page.locator('h3:has-text("Delete organisation")').count();
      assert(modalOpen === 0, 'modal should close on cancel');
      step('cancel modal');

      await page.click('[data-testid="delete-org"]');
      await page.click('[data-testid="delete-org-confirm"]');
      await expectToast(page, 'Demo');
      step('confirm delete (demo no-op)');

      await page.click('button[role="tab"]:has-text("General")');
      const finalName = await page.locator('input[aria-label="org name"]').inputValue();
      assert(finalName === 'acme corp', `name should persist across tab switches, got "${finalName}"`);
      step('org name persisted across tabs');

      await navTo(page, 'nav-alerts', /\/alerts/, 'Alerts');
      step('navigate to alerts');
    },
  },

  // ---- 13. Trace exploration ----
  {
    name: 'trace_exploration',
    description: 'Filter traces, drill into one, inspect the waterfall, select a span',
    async run({ page, base, step }) {
      await page.goto(`${base}/traces`);
      await expectText(page, 'h1', 'Traces');
      step('load traces');

      const all = await waitForRows(page, 2);
      assert(all >= 2, `expected ≥2 traces, got ${all}`);
      step(`baseline: ${all} traces`);

      await page.fill('[data-testid="trace-search"]', 'orders');
      const afterSearch = await waitForRows(page, 1);
      assert(afterSearch >= 1 && afterSearch < all, `search should narrow, got ${afterSearch}/${all}`);
      step('search "orders" narrows list');

      await page.fill('[data-testid="trace-search"]', '');
      await page.selectOption('[data-testid="trace-status"]', 'error');
      const onlyErrors = await waitForRows(page, 1);
      assert(onlyErrors >= 1 && onlyErrors < all, `error filter should narrow, got ${onlyErrors}/${all}`);
      step('filter to error traces');

      await page.selectOption('[data-testid="trace-project"]', 'api');
      step('further filter project=api');

      await page.selectOption('[data-testid="trace-status"]', 'all');
      await page.selectOption('[data-testid="trace-project"]', 'all');
      step('clear filters');

      await page.goto(`${base}/traces/tr_a1b2c3d4e5f6`);
      await expectUrl(page, /\/traces\/tr_a1b2c3d4e5f6/);
      step('drill into known trace');

      await expectText(page, 'h1', 'POST /api/orders');
      const spanCount = await page.locator('[data-testid^="waterfall-span-"]').count();
      assert(spanCount >= 2, `expected ≥2 spans, got ${spanCount}`);
      step(`waterfall renders ${spanCount} spans`);

      await page.locator('[data-testid^="waterfall-span-"]').nth(1).click();
      await expectVisible(page, '[data-testid="selected-span-description"]', 'selected span panel');
      step('select a span — detail panel renders');

      await page.locator('[data-testid^="waterfall-span-"]').nth(0).click();
      step('select the root span');

      await page.click('a:has-text("Traces")');
      await expectUrl(page, /\/traces$/);
      step('breadcrumb back to traces list');
    },
  },

  // ---- 14. Profile flamegraph drill-down ----
  {
    name: 'profile_flamegraph',
    description: 'Open profiles, select a different profile, filter by platform, hover the flame to see self/total',
    async run({ page, base, step }) {
      await page.goto(`${base}/profiles`);
      await expectText(page, 'h1', 'Profiles');
      step('load profiles');

      await expectVisible(page, 'svg[aria-label="flamegraph"]', 'flamegraph rendered');
      step('default flamegraph rendered');

      const profileRows = await waitForRows(page, 2);
      assert(profileRows >= 2, `expected ≥2 profiles, got ${profileRows}`);
      step(`baseline: ${profileRows} profiles`);

      await page.locator('table tbody tr').nth(1).click();
      step('select second profile');
      await waitFor(120);

      await page.selectOption('[data-testid="profile-platform"]', 'python');
      const pythonOnly = await waitForRows(page, 1);
      assert(pythonOnly === 1, `python filter should show 1, got ${pythonOnly}`);
      step('platform=python narrows to 1');

      await page.locator('table tbody tr').first().click();
      step('select python profile');

      const firstRect = page.locator('[data-testid^="flame-"]').first();
      await firstRect.hover();
      await waitFor(100);
      const hoverInfo = (await page.locator('[data-testid="flame-hover-info"]').textContent()) ?? '';
      assert(/self \d+ms · total \d+ms/.test(hoverInfo), `hover info should show self/total, got "${hoverInfo}"`);
      step('hover info shows self + total time');

      await page.selectOption('[data-testid="profile-platform"]', 'all');
      const allAgain = await waitForRows(page, 2);
      assert(allAgain === profileRows, `clear filter should restore ${profileRows}, got ${allAgain}`);
      step('clear filter restores all');
    },
  },

  // ---- 15. SDK setup wizard ----
  {
    name: 'sdk_setup_wizard',
    description: '4-step setup wizard: pick platform, advance through steps, edit DSN, send test',
    async run({ page, base, step }) {
      await page.goto(`${base}/sdk-setup`);
      await expectText(page, 'h1', 'SDK setup');
      step('load SDK setup');

      await page.click('[data-testid="platform-python"]');
      step('select platform=python');

      await page.click('[data-testid="wizard-next"]');
      step('next to step 2');

      await expectText(page, 'pre', 'pip install');
      step('install snippet shown');

      await page.click('[data-testid="wizard-next"]');
      step('next to step 3');

      await page.fill('[data-testid="setup-dsn"]', 'https://newkey@relay.example.com/42');
      const snippet = (await page.locator('pre').last().textContent()) ?? '';
      assert(snippet.includes('newkey'), `expected DSN value in snippet, got "${snippet.slice(0, 80)}…"`);
      step('snippet reflects DSN value');

      await page.click('[data-testid="wizard-next"]');
      step('next to step 4');

      await page.click('[data-testid="send-test"]');
      await expectToast(page, 'Test event sent');
      step('send test event, verify toast');

      await expectVisible(page, '[data-testid="test-confirmed"]', 'test-confirmed badge');
      step('confirmation badge visible');

      await page.click('[data-testid="wizard-prev"]');
      await page.click('[data-testid="wizard-prev"]');
      await page.click('[data-testid="wizard-prev"]');
      await expectVisible(page, '[data-testid="platform-python"][aria-pressed="true"]', 'python still selected');
      step('back to step 1, platform selection persists');

      await page.click('[data-testid="platform-rust"]');
      await page.click('[data-testid="wizard-next"]');
      await expectText(page, 'pre', 'cargo add');
      step('switch to rust and verify cargo install snippet');
    },
  },

  // ---- 16. Source maps ----
  {
    name: 'source_maps_upload_verify',
    description: 'Upload a source map, verify a known debug id, then remove a row',
    async run({ page, base, step }) {
      await page.goto(`${base}/source-maps`);
      await expectText(page, 'h1', 'Source Maps');
      step('load source maps');

      const before = await waitForRows(page, 2);
      step(`baseline: ${before} source maps`);

      const knownDebugId = (await page.locator('table tbody tr').first().locator('div.font-mono').first().textContent()) ?? '';
      step(`captured a known debug id: ${knownDebugId.slice(0, 18)}…`);

      await page.fill('[data-testid="upload-filename"]', 'admin.js.map');
      await page.click('[data-testid="upload-submit"]');
      await expectToast(page, 'admin.js.map');
      step('upload new map, verify toast');

      const after = await waitForRows(page, before + 1);
      assert(after === before + 1, `expected ${before + 1} rows after upload, got ${after}`);
      step(`verified ${after} rows`);

      await page.fill('[data-testid="verify-id"]', knownDebugId.trim());
      await page.click('[data-testid="verify-submit"]');
      await expectToast(page, 'Match');
      step('verify known debug id — match toast');

      await page.fill('[data-testid="verify-id"]', '00000000-0000-0000-0000-deadbeefcafe');
      await page.click('[data-testid="verify-submit"]');
      await expectToast(page, 'No source map');
      step('verify unknown id — miss toast');

      const removeBtn = page.locator('table tbody tr:last-child [data-testid^="remove-"]');
      await removeBtn.click();
      await expectToast(page, 'Source map removed');
      step('remove a row, verify toast');

      const restored = await waitForRows(page, before);
      assert(restored === before, `expected ${before} rows after remove, got ${restored}`);
      step(`back to ${restored} rows`);
    },
  },

  // ---- 17. Saved searches ----
  {
    name: 'saved_searches_crud',
    description: 'Create a saved search, pin it, run it (navigate), then delete it',
    async run({ page, base, step }) {
      await page.goto(`${base}/saved-searches`);
      await expectText(page, 'h1', 'Saved searches');
      step('load saved searches');

      const pinnedBefore = await page.locator('main li').count();
      step(`baseline list rows: ${pinnedBefore}`);

      await page.click('[data-testid="create-search"]');
      await expectVisible(page, 'h3:has-text("New saved search")', 'create modal');
      step('open create modal');

      await page.fill('[data-testid="search-name"]', 'My errors in last 24h');
      await page.fill('[data-testid="search-query"]', 'is:unresolved level:error');
      await page.selectOption('[data-testid="search-target"]', 'issues');
      step('fill the form');

      await page.click('[data-testid="create-search-confirm"]');
      await expectToast(page, 'My errors in last 24h');
      step('save and verify toast');

      const allList = page.locator('main:has-text("All saved searches") li, main li');
      await expectText(page, 'main', 'My errors in last 24h');
      step('new entry visible');

      const newRow = page.locator('li:has-text("My errors in last 24h")').first();
      const pinBtn = newRow.locator('[data-testid^="pin-"]');
      await pinBtn.click();
      step('pin the new entry');

      const runLink = newRow.locator('[data-testid^="run-"]');
      const href = await runLink.getAttribute('href');
      assert(href === '/issues', `expected /issues, got ${href}`);
      step('open-link href targets /issues');

      // Stay on /saved-searches to keep state intact; delete the entry.
      const myRow = page.locator('li:has-text("My errors in last 24h")').first();
      await myRow.locator('[data-testid^="remove-"]').click();
      await expectToast(page, 'removed');
      step('delete the saved search');

      const stillThere = await page.locator('main:has-text("My errors in last 24h")').count();
      assert(stillThere === 0, 'deleted entry should no longer be visible');
      step('verified entry is gone');
      void allList;
    },
  },

  // ---- 18. Notifications + keyboard shortcuts ----
  {
    name: 'notifications_and_shortcuts',
    description: 'Bell opens activity panel; ? opens keyboard shortcuts modal; outside-click + Esc close',
    async run({ page, base, step }) {
      await page.goto(`${base}/`);
      step('load dashboard');

      await expectVisible(page, '[data-testid="notifications-badge"]', 'unread badge');
      step('bell shows unread badge');

      await page.click('[data-testid="notifications-bell"]');
      await expectVisible(page, '[data-testid="notifications-panel"]', 'notifications panel');
      step('open notifications panel');

      const items = await page.locator('[data-testid="notifications-panel"] li').count();
      assert(items >= 3, `expected ≥3 activity items, got ${items}`);
      step(`panel shows ${items} activity items`);

      const stillBadge = await page.locator('[data-testid="notifications-badge"]').count();
      assert(stillBadge === 0, 'badge should clear after opening the panel');
      step('unread badge cleared');

      await page.click('main', { position: { x: 200, y: 200 } });
      await waitFor(120);
      const panelOpen = await page.locator('[data-testid="notifications-panel"]').count();
      assert(panelOpen === 0, 'panel should close on outside click');
      step('outside click closes panel');

      await page.click('[data-testid="help-button"]');
      await expectVisible(page, '[data-testid="shortcuts-list"]', 'shortcuts list');
      const shortcuts = await page.locator('[data-testid="shortcuts-list"] li').count();
      assert(shortcuts >= 8, `expected ≥8 shortcut entries, got ${shortcuts}`);
      step(`shortcuts modal shows ${shortcuts} entries`);

      await page.keyboard.press('Escape');
      await waitFor(120);
      const stillShortcuts = await page.locator('[data-testid="shortcuts-list"]').count();
      assert(stillShortcuts === 0, 'shortcuts modal should close on Escape');
      step('Esc closes shortcuts modal');

      await page.locator('body').click({ force: true });
      await page.keyboard.press('?');
      await expectVisible(page, '[data-testid="shortcuts-list"]', 'shortcuts list (via ?)');
      step('? key reopens shortcuts modal');

      await page.click('button[aria-label="close"]');
      await waitFor(120);
      const finalCheck = await page.locator('[data-testid="shortcuts-list"]').count();
      assert(finalCheck === 0, 'shortcuts modal should close via X');
      step('close via X button');
    },
  },
];

// ----- Runner ------------------------------------------------------------

async function runJourney(
  browser: Browser,
  base: string,
  spec: JourneySpec,
): Promise<JourneyResult> {
  const errors: string[] = [];
  const logs: string[] = [];
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();

  page.on('console', (msg: ConsoleMessage) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') errors.push(`[error] ${text}`);
    else if (type === 'warning') errors.push(`[warning] ${text}`);
    logs.push(`[${type}] ${text}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });

  const start = Date.now();
  let steps = 0;
  let ok = true;
  let failure: string | undefined;
  let screenshot: string | undefined;
  function step(_label?: string): void {
    steps++;
  }

  try {
    await spec.run({ page, base, errors, logs, step });
    screenshot = path.join(SCREENSHOTS_DIR, `${spec.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
  } catch (e) {
    ok = false;
    failure = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    try {
      screenshot = path.join(SCREENSHOTS_DIR, `${spec.name}__FAIL.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
    } catch {
      // ignore
    }
  }

  const elapsedMs = Date.now() - start;
  // Filter out noise — anything else (real errors/warnings) fails the journey.
  const consoleErrors = errors.filter((e) => {
    if (e.includes('Download the React DevTools')) return false;
    if (e.includes('vite] connecting')) return false;
    if (e.includes('vite] connected')) return false;
    if (e.includes('vite] hot updated')) return false;
    if (e.includes('vite] hmr update')) return false;
    return true;
  });

  if (ok && consoleErrors.length > 0) {
    ok = false;
    failure = `console errors: ${consoleErrors.slice(0, 3).join(' | ')}`;
  }

  await ctx.close();
  return Object.freeze({
    name: spec.name,
    description: spec.description,
    ok,
    ...(failure !== undefined ? { failure } : {}),
    steps,
    elapsedMs,
    consoleErrors,
    ...(screenshot !== undefined ? { screenshot } : {}),
  });
}

function parseArgs(argv: readonly string[]): { readonly base: string; readonly only?: string } {
  let base = 'http://localhost:8080';
  let only: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--base=')) base = arg.substring(7);
    else if (arg.startsWith('--only=')) only = arg.substring(7);
  }
  return only !== undefined ? { base, only } : { base };
}

async function main(): Promise<number> {
  const { base, only } = parseArgs(process.argv.slice(2));
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  console.log(`\nUI e2e — base: ${base}`);
  console.log(`Journeys: ${journeys.length}\n`);

  try {
    const res = await fetch(`${base}/`);
    if (!res.ok) {
      console.error(`Dev server at ${base} returned status ${res.status}`);
      return 2;
    }
  } catch (e) {
    console.error(`Dev server at ${base} is unreachable: ${(e as Error).message}`);
    return 2;
  }

  const browser = await chromium.launch({ headless: true });
  const results: JourneyResult[] = [];
  for (let i = 0; i < journeys.length; i++) {
    const j = journeys[i] as JourneySpec;
    if (only !== undefined && j.name !== only) continue;
    process.stdout.write(`[${i + 1}/${journeys.length}] ${j.name}... `);
    const r = await runJourney(browser, base, j);
    results.push(r);
    if (r.ok) {
      console.log(`OK  (${r.steps} steps, ${r.elapsedMs}ms)`);
    } else {
      console.log(`FAIL — ${r.failure}`);
    }
  }
  await browser.close();

  console.log('\n=== summary ===');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  for (const r of results) {
    const status = r.ok ? 'PASS' : 'FAIL';
    console.log(`  ${status}  ${r.name.padEnd(28)} ${r.steps} steps  ${r.elapsedMs}ms`);
    if (!r.ok && r.failure) {
      console.log(`        → ${r.failure}`);
    }
  }
  console.log(`\n${passed}/${results.length} journeys passed.`);
  if (failed > 0) {
    console.log('\nFailing journeys:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.failure}`);
      for (const e of r.consoleErrors.slice(0, 5)) {
        console.log(`        ${e}`);
      }
    }
  }
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('e2e runner crashed:', e);
      process.exit(2);
    });
}