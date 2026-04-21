import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every routeable screen is scanned. Discovery gap that let C1 (unlabeled
// quote inputs) and S1 (nested-interactive in signals) ship was "we only
// scanned Today and Pipeline"; this file now owns the full per-screen
// axe contract for WCAG 2.1 AA.

const SCREENS: ReadonlyArray<{ readonly label: string; readonly navKey: string; readonly headingPattern: RegExp }> = [
  { label: 'Today', navKey: 't', headingPattern: /.+/ },
  { label: 'Pipeline', navKey: 'p', headingPattern: /.+/ },
  { label: 'Pond', navKey: 'h', headingPattern: /.+/ },
  { label: 'Signals', navKey: 's', headingPattern: /signals/i },
  { label: 'Account', navKey: 'a', headingPattern: /mels/i },
  { label: 'Quote', navKey: 'q', headingPattern: /quote/i },
  { label: 'Workflows', navKey: 'w', headingPattern: /workflows/i },
];

test.describe('axe — WCAG 2.1 AA per-screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  for (const s of SCREENS) {
    test(`${s.label} is axe-clean (no serious/critical)`, async ({ page }) => {
      // Navigate via the keyboard shortcut so the test runs through the
      // same Route Transition users do, not a side-door render.
      if (s.navKey !== 't') {
        await page.keyboard.press('g');
        await page.keyboard.press(s.navKey);
        // Pipeline lacks an h1; every other screen has one. For pipeline we
        // rely on the data-screen-label marker already set by App.tsx.
        if (s.label === 'Pipeline') {
          await expect(page.locator('[data-screen-label="02 Pipeline"]')).toBeVisible();
        } else {
          await expect(page.getByRole('heading', { level: 1, name: s.headingPattern })).toBeVisible();
        }
      }

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blockers = results.violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? '')
      );
      expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
    });
  }
});
