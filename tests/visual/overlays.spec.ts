import { test, expect } from '@playwright/test';
import { stabilize, gotoScreen } from './_helpers';

test.describe('Visual regression — overlays', () => {
  test.beforeEach(async ({ page }) => {
    await stabilize(page);
  });

  test('Command palette open', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveScreenshot('palette-open.png');
  });

  test('Ground: paper', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('spear:v1:tweaks', JSON.stringify({
        ground: 'paper', pipeLayout: 'kanban', density: 'comfortable', todaySort: 'stage',
      }));
    });
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await gotoScreen(page, 't');
    await expect(page).toHaveScreenshot('today-paper.png', { fullPage: true });
  });

  test('Manager role — ManagerToday', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('spear:v1:role', 'mgr'));
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await gotoScreen(page, 't');
    await expect(page).toHaveScreenshot('today-mgr.png', { fullPage: true });
  });
});
