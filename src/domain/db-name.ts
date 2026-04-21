// IndexedDB name holder — kept in its own module so the seed-activation
// path in `main.tsx` can read/write it without pulling `events.ts` (and
// therefore Zod, ~20 KB gzip of schema code) into the initial JS chunk.
//
// Lifecycle:
//   - Default: 'spear-events' (the user's real database).
//   - Seed scenarios override via `setDbName()` BEFORE `events.ts` calls
//     `lockDbName()` on the first `openDb()`.
//   - After locking, `setDbName()` is a no-op with a console warning —
//     you cannot swap DBs mid-flight.

let DB_NAME = 'spear-events';
let locked = false;

export function setDbName(name: string): void {
  if (locked) {
    console.warn('[db-name] setDbName called after first openDb(); ignored');
    return;
  }
  DB_NAME = name;
}

export function getDbName(): string {
  return DB_NAME;
}

/** Call from `events.ts` the first time `openDb()` runs. */
export function lockDbName(): void {
  locked = true;
}

/** Test-only: reset both the name and the lock so tests can simulate fresh tabs. */
export function _resetDbNameForTests(name = 'spear-events'): void {
  DB_NAME = name;
  locked = false;
}
