// Gate 3 (Phase 3 PR 1): real DB survives a scenario round-trip.
//
// This is the load-bearing safety test for Phase 3. If it ever goes red,
// the contract that "navigating to `/?seed=<X>` never touches the user's
// real data" is broken. STOP and DIAGNOSE before shipping anything on
// top.
//
// Protocol:
//   1. Load the default app on `/`. Confirm the canonical scenario seeded
//      the user's real DB (some promises exist).
//   2. Navigate to `/?seed=busy-rep`. Scenario should load into a
//      separate, namespaced IndexedDB. Confirm busy-rep's shape.
//   3. Navigate back to `/`. The user's real DB should be intact —
//      same promises, same deal count, same screens.

import { test, expect } from '@playwright/test';

/**
 * Read counts from a named IndexedDB's stores. Returns -1 on any error.
 * Does not wait for seeding to complete — callers use `expect.poll` to
 * handle the async hydration that runs after first paint.
 */
async function readCounts(
  page: import('@playwright/test').Page,
  dbName: string
): Promise<{ promiseCount: number; dealCount: number }> {
  return page.evaluate(async (name) => {
    return new Promise<{ promiseCount: number; dealCount: number }>((resolve) => {
      const req = indexedDB.open(name);
      req.onerror = () => resolve({ promiseCount: -1, dealCount: -1 });
      req.onsuccess = () => {
        const db = req.result;
        const promiseCountP = db.objectStoreNames.contains('promises')
          ? new Promise<number>((res) => {
              const tx = db.transaction('promises', 'readonly');
              const c = tx.objectStore('promises').count();
              c.onsuccess = () => res(c.result);
              c.onerror = () => res(-1);
            })
          : Promise.resolve(0);
        const dealCountP = db.objectStoreNames.contains('events')
          ? new Promise<number>((res) => {
              const tx = db.transaction('events', 'readonly');
              const c = tx.objectStore('events').count();
              c.onsuccess = () => res(c.result);
              c.onerror = () => res(-1);
            })
          : Promise.resolve(0);
        Promise.all([promiseCountP, dealCountP]).then(([p, d]) => {
          db.close();
          resolve({ promiseCount: p, dealCount: d });
        });
      };
    });
  }, dbName);
}

test.describe('Phase 3 PR 1 — real DB survives scenario round-trip', () => {
  test('navigate to ?seed=busy-rep and back preserves real DB state', async ({ page }) => {
    // Step 1: land on the default app, confirm canonical promises seed in.
    // Seeding is async from `bootRuntime()` so we poll IDB until the
    // canonical scenario's 5 promises have persisted — h1 paints well
    // before seeding completes on a fast CI runner.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect
      .poll(async () => (await readCounts(page, 'spear-events')).promiseCount, {
        message: 'canonical scenario did not seed ≥5 promises into the real DB',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(5);
    const realBefore = await readCounts(page, 'spear-events');

    // Step 2: navigate to busy-rep; poll until the seed DB holds ≥20 of
    // each entity (busy-rep seeds ~30 each).
    await page.goto('/?seed=busy-rep');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect
      .poll(async () => (await readCounts(page, 'spear-events-seed-busy-rep')).promiseCount, {
        message: 'busy-rep did not seed ≥20 promises into the isolated DB',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(20);
    await expect
      .poll(async () => (await readCounts(page, 'spear-events-seed-busy-rep')).dealCount, {
        message: 'busy-rep did not seed ≥20 deal events into the isolated DB',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(20);

    // Step 3: navigate back to `/` and verify the real DB is intact.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Real DB's promise count must not drop. Poll in case another async
    // hydrate tick is still in flight from the return navigation.
    await expect
      .poll(async () => (await readCounts(page, 'spear-events')).promiseCount, {
        message: 'real DB count dropped after seed round-trip — isolation broken',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(realBefore.promiseCount);
    // Poll above is the load-bearing assertion: real DB's promise count
    // didn't drop during the seed round-trip. (Vacuum or future-dated
    // canonical promises may increase it; they cannot decrease it.)
  });

  test('charset-invalid ?seed= value falls through to the default app', async ({ page }) => {
    // Fresh context: delete any sibling DBs lingering from the previous test
    // so this test's "no new seed DB" assertion is meaningful.
    await page.goto('/');
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs
          .filter((d) => typeof d.name === 'string' && d.name!.startsWith('spear-events-seed-'))
          .map(
            (d) =>
              new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(d.name!);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              })
          )
      );
    });

    await page.goto('/?seed=../evil');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Path-traversal / shell-meta shapes must not reach `setDbName`. The
    // app renders its default state against the real DB.
    const hasSeedDb = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      return dbs.some(
        (d) => typeof d.name === 'string' && d.name.startsWith('spear-events-seed-')
      );
    });
    expect(hasSeedDb).toBe(false);
  });
});
