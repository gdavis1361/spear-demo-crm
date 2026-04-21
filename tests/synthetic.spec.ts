import { test, expect } from '@playwright/test';

// Synthetic probes run from the `synthetics` GitHub workflow every 5 minutes
// against the production URL (SYNTHETIC_BASE_URL). Symptom-based: "a user
// can land on the app, navigate, open the palette." If any of these fail
// three runs in a row the rollback workflow redeploys the last green SHA.

const BASE_URL = process.env.SYNTHETIC_BASE_URL;

test.describe('synthetic — production', () => {
  test.skip(!BASE_URL, 'SYNTHETIC_BASE_URL not set');

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL!);
    // Wait for first paint so keydown listeners are installed before any
    // synthetic interactions fire.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('landing paints the Today heading', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/waiting on you/i);
  });

  test('keyboard nav: g then p lands on Pipeline', async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page.locator('.app')).toHaveAttribute('data-screen-label', '02 Pipeline');
  });

  test('Cmd+K opens the command palette', async ({ page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
