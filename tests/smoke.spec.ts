import { test, expect } from '@playwright/test';

test.describe('Spear CRM — smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear persisted state so each test starts fresh
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('landing loads the Today screen', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/waiting on you/i);
    await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();
  });

  test('Rail keyboard nav: g then p lands on Pipeline', async ({ page }) => {
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/pipeline/i);
  });

  test('Rail click nav: Signals', async ({ page }) => {
    await page.getByRole('button', { name: 'Signals' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/signals feed/i);
  });

  test('Cmd+K opens the command palette as a dialog', async ({ page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('combobox')).toBeFocused();
  });

  test('skip-link is keyboard accessible', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip to main content/i })).toBeFocused();
  });
});
