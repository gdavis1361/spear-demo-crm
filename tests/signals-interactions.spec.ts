// End-to-end verification of R4 (Linear runtime-reliability audit):
// signal dismiss/action must produce visible, screen-reader-perceivable
// feedback. Before the fix, clicking Dismiss only fired telemetry on
// success — the row stayed in the list, the detail pane stayed open on
// the same signal, and there was no announcement. Indistinguishable
// from a dead button.
//
// Pairs with `src/screens/signals.tsx`. If either of these tests fails,
// the demo's signal interactions have silently regressed.

import { test, expect } from '@playwright/test';

async function gotoSignals(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Signals' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /signals feed/i })).toBeVisible();
}

test.describe('R4 · signal dismiss produces visible + SR feedback', () => {
  test('clicking Dismiss removes the row from the grid and moves selection', async ({ page }) => {
    await gotoSignals(page);

    // Pre-state: the default-selected signal (SIG-00241) is visible.
    const firstRow = page.locator('.sig-row').first();
    const firstRowLabel = await firstRow.getAttribute('aria-label');
    expect(firstRowLabel).toContain('Signal SIG-00241');

    const rowCountBefore = await page.locator('.sig-row').count();
    expect(rowCountBefore).toBeGreaterThan(1);

    // Act: click the Dismiss button in the detail pane.
    await page.getByRole('button', { name: /^Dismiss$/ }).click();

    // Row is gone from the grid.
    await expect(
      page.locator('.sig-row', { hasText: 'SIG-00241' })
    ).toHaveCount(0);

    // Grid shrunk by exactly one.
    await expect(page.locator('.sig-row')).toHaveCount(rowCountBefore - 1);

    // Detail pane moved to a *different* signal (not the dismissed one).
    await expect(
      page.locator('.sig-detail').getByText('SIG-00241', { exact: false })
    ).toHaveCount(0);
  });

  test('clicking Dismiss announces via the live region', async ({ page }) => {
    await gotoSignals(page);

    await page.getByRole('button', { name: /^Dismiss$/ }).click();

    // The live region is `.sr-only` but DOM-visible to Playwright. One of
    // the two rotating nodes now carries the announcement.
    const liveRegions = page.locator('[aria-live="polite"]');
    await expect(liveRegions.filter({ hasText: /dismissed signal sig-00241/i })).toHaveCount(1);
  });
});

test.describe('R4 · signal Actioned marks the row and disables the button', () => {
  test('clicking Actioned marks row `.done` and disables both buttons', async ({ page }) => {
    await gotoSignals(page);

    const dismissBtn = page.getByRole('button', { name: /^Dismiss$/ });
    const actionedBtn = page.getByRole('button', { name: /^Actioned$/ });

    await actionedBtn.click();

    // Row stays in the grid (unlike dismiss) but gains `.done`.
    await expect(page.locator('.sig-row.done', { hasText: 'SIG-00241' })).toHaveCount(1);

    // Both mutation buttons disable so a second click can't no-op.
    await expect(dismissBtn).toBeDisabled();
    await expect(actionedBtn).toBeDisabled();

    // aria-label on the row reflects the actioned state so SR users hear it.
    const labelled = await page
      .locator('.sig-row', { hasText: 'SIG-00241' })
      .getAttribute('aria-label');
    expect(labelled?.toLowerCase()).toContain('actioned');
  });
});
