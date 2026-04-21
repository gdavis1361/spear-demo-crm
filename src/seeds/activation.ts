// Browser activation: detect `?seed=<name>` + swap the EventLog's DB name.
// Called from `main.tsx` BEFORE any import triggers EventLog construction
// so that the whole app (PromiseStore, DealProjection, ScheduleRegistry,
// vacuum) binds to the isolated seed DB, not the user's real one.
//
// **This module must be cheap to import.** It runs at the top of main.tsx
// and goes into the initial JS chunk. So it deliberately does *not* touch
// the scenario registry (which pulls in schema + builders, ~25 KB gzip).
// Instead it does syntactic validation only:
//
//   - The `seed` param must match `^[a-z0-9][a-z0-9-]*$` — this rejects
//     path traversal, shell metas, control chars, etc., and is sufficient
//     to guarantee the derived DB name is a safe sibling of the real one.
//
// Semantic validation ("is this a registered scenario?") happens later in
// `main.tsx`, after `runtime.ts` is dynamically imported and scenarios are
// registered. If an unknown-but-charset-valid name makes it through, the
// runner throws "unknown scenario" at boot, ErrorBoundary renders the
// standard error screen, and a full-page reload to `/` clears the state.
// The user's real DB (`spear-events`) is never touched in any branch.
//
// `setDbName()` itself has a guard: after `openDb()` resolves the first
// connection, it becomes a no-op with a console warning. So even a racy
// late call can't corrupt state.

// Import `setDbName` from `./db-name` directly, NOT from `./events`.
// `./events` drags Zod schemas (~20 KB gzip) into whatever chunk imports
// it; activation runs at the top of `main.tsx` and must stay in the
// initial bundle, so we take the narrow-surface dependency.
import { setDbName } from '../domain/db-name';
import { scenarioName, type ScenarioName } from './types';

export const SEED_DB_PREFIX = 'spear-events-seed-';

/**
 * Syntactic extraction of a seed scenario name from a URL search string.
 * Returns a name only if the charset is safe; does NOT verify the name
 * is a registered scenario (see module header for rationale).
 */
export function detectSeedParam(search: string): ScenarioName | null {
  if (!search || search.length === 0) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('seed');
  if (raw === null || raw.length === 0) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) return null;
  return scenarioName(raw);
}

export interface ActivateResult {
  readonly mode: 'seed' | 'default';
  readonly scenario: ScenarioName | null;
  readonly dbName: string;
}

/**
 * Key used by `consumePendingReset()` to signal across a page reload.
 * Write the scenario name under this key in sessionStorage, then
 * `location.reload()`. On the next boot, the marker is consumed and the
 * scenario's IndexedDB is deleted *before* any connection opens — which
 * is the only way to guarantee the `indexedDB.deleteDatabase()` call
 * isn't blocked by a live connection from the previous load.
 */
const RESET_MARKER_KEY = 'spear:reset-seed';

/**
 * If a pending Reset marker exists, delete the target seed DB and clear
 * the marker. Must be called at the top of `main.tsx`, BEFORE any store
 * opens a connection and BEFORE `activateSeedFromUrl()` runs. Safe no-op
 * when no marker is set.
 */
export async function consumePendingReset(): Promise<void> {
  if (typeof sessionStorage === 'undefined' || typeof indexedDB === 'undefined') return;
  const seed = sessionStorage.getItem(RESET_MARKER_KEY);
  if (seed === null || seed.length === 0) return;
  sessionStorage.removeItem(RESET_MARKER_KEY);
  // Charset gate — same posture as detectSeedParam. Reject early if
  // sessionStorage was tampered with.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(seed)) return;
  const dbName = `${SEED_DB_PREFIX}${seed}`;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    const done = (): void => resolve();
    req.onsuccess = done;
    req.onerror = done;
    req.onblocked = done;
  });
}

/**
 * Arm a Reset that fires on the next page load. `reload()` is the last
 * call from the UI; on boot, `consumePendingReset()` deletes the DB
 * while no connection is open.
 */
export function requestSeedReset(scenario: string): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(RESET_MARKER_KEY, scenario);
}

/**
 * Inspect the current URL; if `?seed=<name>` passes charset validation,
 * call `setDbName('spear-events-seed-<name>')` so every subsequent store
 * binds to the isolated DB. Otherwise no-op (default DB).
 *
 * Call this from `main.tsx` BEFORE the first `eventLog` usage.
 */
export function activateSeedFromUrl(
  search: string = typeof location !== 'undefined' ? location.search : ''
): ActivateResult {
  const scenario = detectSeedParam(search);
  if (scenario === null) {
    return { mode: 'default', scenario: null, dbName: 'spear-events' };
  }
  const dbName = `${SEED_DB_PREFIX}${scenario}`;
  setDbName(dbName);
  return { mode: 'seed', scenario, dbName };
}
