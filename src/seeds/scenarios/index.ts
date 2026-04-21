// Scenario registration. Import this module once (from `src/seeds/index.ts`)
// to make all scenarios available via `registry`.

import { registry } from '../registry';
import { emptyScenario } from './empty';
import { canonicalScenario } from './canonical';

let registered = false;

export function registerAllScenarios(): void {
  if (registered) return;
  registered = true;
  registry.register(emptyScenario);
  registry.register(canonicalScenario);
}

/** Test-only: unregister everything + reset the `registered` flag. */
export function _unregisterAllForTests(): void {
  registry._reset();
  registered = false;
}
