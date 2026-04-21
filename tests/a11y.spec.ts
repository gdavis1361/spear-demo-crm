import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('axe — WCAG 2.1 AA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('Today is axe-clean (no serious/critical)', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blockers = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });

  test('Pipeline is axe-clean', async ({ page }) => {
    await page.getByRole('button', { name: 'Pipeline' }).click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blockers = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });
});
