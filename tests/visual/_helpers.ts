import type { Page } from '@playwright/test';

/** Anchor for Playwright's clock — keeps "Good morning" deterministic. */
export const FROZEN_NOW = '2026-04-21T13:47:00Z'; // 08:47 CDT

export interface StabilizeOptions {
  /**
   * Scenario to run via `?seed=<name>`. When omitted, the test runs
   * against the default (canonical) DB — the same behavior the app has
   * without any URL param.
   */
  readonly seed?: string;
}

/**
 * Lock down the page so the same URL renders the same pixels every run:
 *   - fixed viewport (set via project config)
 *   - frozen clock (`Date.now()` returns FROZEN_NOW — freezes every
 *     setInterval/setTimeout in the app, including the PromiseTicker
 *     and the demo workflow runner; nothing in the app reads
 *     performance.now() for scheduling)
 *   - no CSS transitions/animations
 *   - fonts fully loaded
 *   - empty localStorage (but the scenario's IDB is preserved; seed
 *     builds use `opKey` for idempotent writes, so re-runs are safe)
 *   - network idle (projection hydration has settled)
 */
export async function stabilize(page: Page, opts: StabilizeOptions = {}) {
  await page.clock.install({ time: FROZEN_NOW });
  const url = opts.seed ? `/?seed=${opts.seed}` : '/';
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

/** Navigate to a screen via the keyboard shortcut; tests stay fast + deterministic. */
export async function gotoScreen(
  page: Page,
  letter: 't' | 'p' | 'h' | 's' | 'a' | 'q' | 'w'
): Promise<void> {
  await page.keyboard.press('g');
  await page.keyboard.press(letter);
  // Let the lazy chunk resolve + a frame paint.
  await page.waitForTimeout(100);
  await page.evaluate(() => document.fonts.ready);
}
