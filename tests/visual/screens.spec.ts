import { test, expect } from '@playwright/test';
import { stabilize, gotoScreen } from './_helpers';

// Per-scenario visual regression matrix.
//
// Default: runs against the app's canonical DB (no `?seed=` param) —
// byte-identical to Phase 2's baselines, filenames preserved so the
// existing snapshots keep passing.
//
// busy-rep: the "overloaded rep" scenario (30 deals + promise-status
// matrix) gets its own baseline per screen. Loaded via `?seed=busy-rep`
// against an isolated IndexedDB, so it never touches canonical data.
//
// We intentionally skip the `empty` scenario: `bootstrapDealsIfEmpty`
// seeds the static DEALS fixture when the log has no deal events, so
// the `empty` scenario's rendered screens are indistinguishable from
// canonical — snapshotting them would be duplicate churn, not coverage.

interface ScenarioCase {
  readonly label: string;
  /** Seed param (omitted → canonical / default DB). */
  readonly seed?: string;
  /** Snapshot prefix; '' means reuse the original canonical filenames. */
  readonly prefix: string;
}

const SCENARIOS: readonly ScenarioCase[] = [
  { label: 'default (canonical)', seed: undefined, prefix: '' },
  { label: 'busy-rep', seed: 'busy-rep', prefix: 'busy-rep-' },
];

for (const s of SCENARIOS) {
  test.describe(`Visual regression — screens (${s.label})`, () => {
    test.beforeEach(async ({ page }) => {
      await stabilize(page, { seed: s.seed });
    });

    test('01 Today (rep)', async ({ page }) => {
      await gotoScreen(page, 't');
      await expect(page).toHaveScreenshot(`${s.prefix}today-rep.png`, { fullPage: true });
    });

    test('02 Pipeline (kanban)', async ({ page }) => {
      await gotoScreen(page, 'p');
      await expect(page).toHaveScreenshot(`${s.prefix}pipeline-kanban.png`, { fullPage: true });
    });

    test('03 Pond (rep)', async ({ page }) => {
      await gotoScreen(page, 'h');
      await expect(page).toHaveScreenshot(`${s.prefix}pond-rep.png`, { fullPage: true });
    });

    test('04 Signals', async ({ page }) => {
      await gotoScreen(page, 's');
      await expect(page).toHaveScreenshot(`${s.prefix}signals.png`, { fullPage: true });
    });

    test('05 Account 360', async ({ page }) => {
      await gotoScreen(page, 'a');
      await expect(page).toHaveScreenshot(`${s.prefix}account.png`, { fullPage: true });
    });

    test('06 Quote builder', async ({ page }) => {
      await gotoScreen(page, 'q');
      await expect(page).toHaveScreenshot(`${s.prefix}quote.png`, { fullPage: true });
    });

    test('07 Workflows', async ({ page }) => {
      await gotoScreen(page, 'w');
      await expect(page).toHaveScreenshot(`${s.prefix}workflows.png`, { fullPage: true });
    });
  });
}
