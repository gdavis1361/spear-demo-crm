// Gates 7, 8, 9 (Phase 3 PR 3): the DevPalette scenario switcher.
//
//   Gate 7 — Cmd+Shift+S (Meta/Ctrl) opens the palette and it lists every
//            registered scenario, with the current one badged.
//   Gate 8 — Selecting a scenario navigates to ?seed=<name>; selecting
//            "Exit scenario" navigates back to /.
//   Gate 9 — The palette is axe-clean at WCAG 2.1 AA.
//
// Together these close the contract that any developer viewing the CRM
// can switch between seeded scenarios without touching the URL bar.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Cmd on darwin, Ctrl elsewhere. Playwright's Chromium defaults to the
// host OS modifier only when you press "Meta"/"Control" literally; for
// cross-platform we just use the explicit key name.
const PLATFORM_MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openPalette(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.down(PLATFORM_MOD);
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyS');
  await page.keyboard.up('Shift');
  await page.keyboard.up(PLATFORM_MOD);
}

test.describe('Phase 3 PR 3 — DevPalette', () => {
  test('Gate 7: Cmd/Ctrl+Shift+S opens palette and lists registered scenarios', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Closed by default.
    await expect(page.getByRole('dialog', { name: /scenario switcher/i })).toHaveCount(0);

    await openPalette(page);

    const dialog = page.getByRole('dialog', { name: /scenario switcher/i });
    await expect(dialog).toBeVisible();

    // Registry-driven: canonical + busy-rep + empty. Don't hardcode —
    // we just assert each expected one shows up.
    const list = dialog.getByRole('listbox', { name: /scenarios/i });
    await expect(list.getByRole('option', { name: /exit scenario/i })).toBeVisible();
    await expect(list.getByRole('option', { name: /^canonical/i })).toBeVisible();
    await expect(list.getByRole('option', { name: /^busy-rep/i })).toBeVisible();
    await expect(list.getByRole('option', { name: /^empty/i })).toBeVisible();

    // No "current" badge when we're on /.
    await expect(dialog.locator('[data-current="true"]')).toHaveCount(0);
  });

  test('Gate 7b: Escape closes the palette', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await openPalette(page);
    await expect(page.getByRole('dialog', { name: /scenario switcher/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /scenario switcher/i })).toHaveCount(0);
  });

  test('Gate 7c: current scenario is badged when a seed is active', async ({ page }) => {
    await page.goto('/?seed=busy-rep');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status', { name: /scenario mode active/i })).toBeVisible();

    await openPalette(page);
    const dialog = page.getByRole('dialog', { name: /scenario switcher/i });
    await expect(dialog).toBeVisible();
    // The busy-rep option carries data-current="true".
    await expect(dialog.locator('[data-current="true"]')).toHaveCount(1);
    await expect(dialog.locator('[data-current="true"]')).toContainText(/busy-rep/);
  });

  test('Gate 8: clicking a scenario navigates to ?seed=<name>', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await openPalette(page);
    const dialog = page.getByRole('dialog', { name: /scenario switcher/i });
    await dialog.getByRole('option', { name: /^busy-rep/i }).click();

    await page.waitForURL('**/?seed=busy-rep', { timeout: 10_000 });
    await expect(page.getByRole('status', { name: /scenario mode active/i })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('seed')).toBe('busy-rep');
  });

  test('Gate 8b: clicking "Exit scenario" from a seeded view navigates to /', async ({ page }) => {
    await page.goto('/?seed=busy-rep');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status', { name: /scenario mode active/i })).toBeVisible();

    await openPalette(page);
    const dialog = page.getByRole('dialog', { name: /scenario switcher/i });
    await dialog.getByRole('option', { name: /exit scenario/i }).click();

    await page.waitForURL('**/', { timeout: 10_000 });
    await expect(page.getByRole('status', { name: /scenario mode active/i })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('seed')).toBeNull();
  });

  test('Gate 9: palette is axe-clean (no serious/critical WCAG violations)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await openPalette(page);
    await expect(page.getByRole('dialog', { name: /scenario switcher/i })).toBeVisible();
    // Wait for the registry to hydrate (lazy import).
    await expect(
      page.getByRole('dialog').getByRole('option', { name: /^canonical/i })
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.devp-overlay')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const blockers = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? '')
    );
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });
});
