import type { Page } from '@playwright/test';

/** Anchor for Playwright's clock — keeps "Good morning" deterministic. */
export const FROZEN_NOW = '2026-04-21T13:47:00Z'; // 08:47 CDT

/**
 * Lock down the page so the same URL renders the same pixels every run:
 *   - fixed viewport (set via project config)
 *   - frozen clock (`Date.now()` returns FROZEN_NOW)
 *   - no CSS transitions/animations
 *   - fonts fully loaded
 *   - empty localStorage
 */
export async function stabilize(page: Page) {
  await page.clock.install({ time: FROZEN_NOW });
  await page.goto('/');
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
