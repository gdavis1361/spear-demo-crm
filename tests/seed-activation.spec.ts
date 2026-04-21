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

test.describe('Phase 3 PR 1 — real DB survives scenario round-trip', () => {
  test('navigate to ?seed=busy-rep and back preserves real DB state', async ({ page }) => {
    // Step 1: land on the default app, confirm canonical promises are visible.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Read the canonical DB's promise count from its IndexedDB directly so
    // we have an objective fingerprint, not a UI-layer approximation.
    const realBefore = await page.evaluate(async () => {
      return new Promise<{ dbs: string[]; promiseCount: number }>((resolve) => {
        // Count promises in `spear-events` → `promises` store.
        const req = indexedDB.open('spear-events');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('promises')) {
            db.close();
            resolve({ dbs: Array.from(db.objectStoreNames), promiseCount: 0 });
            return;
          }
          const tx = db.transaction('promises', 'readonly');
          const ps = tx.objectStore('promises');
          const count = ps.count();
          count.onsuccess = () => {
            db.close();
            resolve({ dbs: Array.from(db.objectStoreNames), promiseCount: count.result });
          };
          count.onerror = () => {
            db.close();
            resolve({ dbs: [], promiseCount: -1 });
          };
        };
        req.onerror = () => resolve({ dbs: [], promiseCount: -1 });
      });
    });
    expect(realBefore.promiseCount).toBeGreaterThanOrEqual(5);

    // Step 2: navigate to busy-rep and verify its DB exists with more data.
    await page.goto('/?seed=busy-rep');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const seedSnapshot = await page.evaluate(async () => {
      return new Promise<{ promiseCount: number; dealCount: number }>((resolve) => {
        const req = indexedDB.open('spear-events-seed-busy-rep');
        req.onsuccess = () => {
          const db = req.result;
          const promiseCount = new Promise<number>((res) => {
            const tx = db.transaction('promises', 'readonly');
            const c = tx.objectStore('promises').count();
            c.onsuccess = () => res(c.result);
            c.onerror = () => res(-1);
          });
          const dealCount = new Promise<number>((res) => {
            const tx = db.transaction('events', 'readonly');
            const c = tx.objectStore('events').count();
            c.onsuccess = () => res(c.result);
            c.onerror = () => res(-1);
          });
          Promise.all([promiseCount, dealCount]).then(([p, d]) => {
            db.close();
            resolve({ promiseCount: p, dealCount: d });
          });
        };
        req.onerror = () => resolve({ promiseCount: -1, dealCount: -1 });
      });
    });
    // busy-rep seeds ~30 promises and ~30 deal.created events.
    expect(seedSnapshot.promiseCount).toBeGreaterThanOrEqual(20);
    expect(seedSnapshot.dealCount).toBeGreaterThanOrEqual(20);

    // Step 3: navigate back to `/` and verify the real DB is intact.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const realAfter = await page.evaluate(async () => {
      return new Promise<number>((resolve) => {
        const req = indexedDB.open('spear-events');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('promises')) {
            db.close();
            resolve(0);
            return;
          }
          const tx = db.transaction('promises', 'readonly');
          const c = tx.objectStore('promises').count();
          c.onsuccess = () => {
            db.close();
            resolve(c.result);
          };
          c.onerror = () => {
            db.close();
            resolve(-1);
          };
        };
        req.onerror = () => resolve(-1);
      });
    });

    // The real DB's promise count must not have dropped during the seed
    // round-trip. (Vacuum or future-dated canonical promises may increase
    // it; they cannot decrease it.)
    expect(realAfter).toBeGreaterThanOrEqual(realBefore.promiseCount);
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
