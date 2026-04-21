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
