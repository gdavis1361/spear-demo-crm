// Interaction-level a11y regressions for the critical + serious findings
// the Deque audit turned up. Companion to `a11y.spec.ts` (which axe-scans
// the rendered DOM statically) — these exercise dynamic behavior that
// axe can't see: focus trap cycles, focus return, live-region content,
// grid keyboard navigation.
//
// One test per finding (C1, C2, S1, S2, S3, S4). Each test's failure
// maps back to a single WCAG criterion so a reviewer reading the CI
// output knows exactly which accessibility bar broke.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const META = process.platform === 'darwin' ? 'Meta' : 'Control';

async function gotoScreen(page: import('@playwright/test').Page, letter: string): Promise<void> {
  await page.keyboard.press('g');
  await page.keyboard.press(letter);
}

test.describe('C1 — WCAG 3.3.2 / 4.1.2 · Form inputs have accessible names', () => {
  test('Quote screen inputs + select have programmatic labels', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await gotoScreen(page, 'q');
    await expect(page.getByRole('heading', { level: 1, name: /quote/i })).toBeVisible();

    // Each labeled field should be findable by its label text via ARIA name.
    // `getByLabel` uses the accessible-name computation axe-core also uses.
    // `exact: true` so "Origin" doesn't collide with the "Remove line:
    // Origin services" button aria-label elsewhere on the screen.
    await expect(page.getByLabel('Origin', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Destination', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Report date', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Requested pack', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Estimated weight', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Service tier', { exact: true })).toBeVisible();

    // Defense-in-depth: axe must stop reporting `label` / `select-name`.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blockers = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? '')
    );
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });
});

test.describe('C2 — WCAG 2.4.1 · Skip link target is focusable', () => {
  test('activating "Skip to main content" lands focus inside <main>', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Tab off the body to reveal the skip link (visually hidden until focus).
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /skip to main content/i });
    await expect(skip).toBeFocused();

    // Activate via Enter (the accessible activation for a link).
    await page.keyboard.press('Enter');

    // Focus must move to <main> — not just stay on the skip link. This is
    // the exact regression C2 was filed for: Safari/WebKit don't focus a
    // non-interactive landmark without `tabIndex={-1}`.
    const mainFocusId = await page.evaluate(() => document.activeElement?.id ?? null);
    expect(mainFocusId).toBe('main');
  });
});

test.describe('S1 — WCAG 4.1.2 · Signals grid has no nested interactive', () => {
  test('Signals is axe-clean (nested-interactive resolved)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await gotoScreen(page, 's');
    await expect(page.getByRole('heading', { level: 1, name: /signals/i })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blockers = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? '')
    );
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);

    // Spot-check: the grid exposes a grid role with rows and selected state.
    const grid = page.getByRole('grid', { name: /signals/i });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('row')).not.toHaveCount(0);
  });

  test('arrow keys navigate rows; Enter selects', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await gotoScreen(page, 's');
    const grid = page.getByRole('grid', { name: /signals/i });
    const rows = grid.getByRole('row');
    const first = rows.nth(0);
    const second = rows.nth(1);

    await first.focus();
    await expect(first).toBeFocused();

    // ArrowDown moves the tab stop; roving tabindex means the first row
    // drops to tabIndex=-1 and the second row becomes tabIndex=0.
    await page.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();

    // Enter on the focused row flips aria-selected.
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
  });
});

test.describe('S2 — WCAG 2.1.2 / 2.4.3 · CommandPalette focus trap + return', () => {
  test('Cmd+K opens palette, Tab cycles, Esc returns focus to trigger', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Put focus on a known element (a rail button), then open the palette.
    const railPipeline = page.getByRole('button', { name: 'Pipeline' });
    await railPipeline.focus();
    await expect(railPipeline).toBeFocused();

    await page.keyboard.press(`${META}+KeyK`);
    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible();

    // Initial focus lands on the search input.
    const input = dialog.getByRole('combobox');
    await expect(input).toBeFocused();

    // Tab forward should stay inside the dialog. We don't pin a specific
    // resulting element (dialog contents evolve), but after one cycle of
    // Tabs, activeElement must still be within the dialog.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() =>
        !!document.activeElement?.closest('[role="dialog"]')
      );
      expect(inside, `Tab #${i + 1} escaped the dialog`).toBe(true);
    }

    // Escape closes + returns focus to the element that opened the palette.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(railPipeline).toBeFocused();
  });
});

test.describe('S3 — WCAG 2.1.2 / 2.4.3 · DevPalette focus trap + return', () => {
  test('Cmd+Shift+S opens palette, Tab cycles, Esc returns focus', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const railToday = page.getByRole('button', { name: 'Today' });
    await railToday.focus();

    await page.keyboard.down(META);
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyS');
    await page.keyboard.up('Shift');
    await page.keyboard.up(META);

    const dialog = page.getByRole('dialog', { name: /scenario switcher/i });
    await expect(dialog).toBeVisible();
    // Wait for the lazy scenarios import to hydrate.
    await expect(dialog.getByRole('option', { name: /^canonical/i })).toBeVisible();

    // Tab trap: same invariant as the command palette.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() =>
        !!document.activeElement?.closest('[role="dialog"]')
      );
      expect(inside, `Tab #${i + 1} escaped the dialog`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(railToday).toBeFocused();
  });
});

test.describe('S4 — WCAG 4.1.3 · Pipeline move is announced via live region', () => {
  test('successful stage move writes the outcome into aria-live', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await gotoScreen(page, 'p');
    // Pipeline has no h1; check the screen label.
    await expect(page.locator('[data-screen-label="02 Pipeline"]')).toBeVisible();

    // Open the keyboard move menu on the first card and pick a target stage.
    const firstMoveBtn = page.getByRole('button', { name: 'Move to stage' }).first();
    await firstMoveBtn.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Pick any menuitem — the announcement text will reflect whichever
    // stage was legal to advance to.
    const firstTarget = menu.getByRole('menuitem').first();
    const targetLabel = (await firstTarget.innerText()).split('\n')[0].trim();
    await firstTarget.click();

    // One of the two live regions must now contain the move announcement.
    // We poll because React commits + live-region state-flip are async.
    await expect
      .poll(async () => {
        const text = await page.evaluate(() => {
          const regions = document.querySelectorAll('[aria-live="polite"]');
          return Array.from(regions)
            .map((r) => r.textContent ?? '')
            .join(' | ');
        });
        return text;
      })
      .toMatch(new RegExp(`moved .* to ${targetLabel.split(/\s+/)[0]}`, 'i'));
  });
});
