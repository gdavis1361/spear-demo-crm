import { test, expect } from '@playwright/test';
import { stabilize, gotoScreen } from './_helpers';

test.describe('Visual regression — screens', () => {
  test.beforeEach(async ({ page }) => {
    await stabilize(page);
  });

  test('01 Today (rep)', async ({ page }) => {
    await gotoScreen(page, 't');
    await expect(page).toHaveScreenshot('today-rep.png', { fullPage: true });
  });

  test('02 Pipeline (kanban)', async ({ page }) => {
    await gotoScreen(page, 'p');
    await expect(page).toHaveScreenshot('pipeline-kanban.png', { fullPage: true });
  });

  test('03 Pond (rep)', async ({ page }) => {
    await gotoScreen(page, 'h');
    await expect(page).toHaveScreenshot('pond-rep.png', { fullPage: true });
  });

  test('04 Signals', async ({ page }) => {
    await gotoScreen(page, 's');
    await expect(page).toHaveScreenshot('signals.png', { fullPage: true });
  });

  test('05 Account 360', async ({ page }) => {
    await gotoScreen(page, 'a');
    await expect(page).toHaveScreenshot('account.png', { fullPage: true });
  });

  test('06 Quote builder', async ({ page }) => {
    await gotoScreen(page, 'q');
    await expect(page).toHaveScreenshot('quote.png', { fullPage: true });
  });

  test('07 Workflows', async ({ page }) => {
    await gotoScreen(page, 'w');
    await expect(page).toHaveScreenshot('workflows.png', { fullPage: true });
  });
});
