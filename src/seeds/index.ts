// Public entry point for the seed system. Importing this registers all
// known scenarios as a side-effect; the registration is idempotent.

import { registerAllScenarios } from './scenarios';

registerAllScenarios();

export { registry } from './registry';
export { runScenario, CURRENT_SCHEMA_VERSION } from './runner';
export { VirtualClock } from './clock';
export { Rng } from './rng';
export { scenarioName } from './types';
export { detectSeedParam, activateSeedFromUrl, SEED_DB_PREFIX } from './activation';
export type {
  Scenario,
  ScenarioCtx,
  ScenarioDescriptor,
  ScenarioName,
  ScenarioResult,
  ScenarioStores,
  RunScenarioOptions,
  InvariantCtx,
} from './types';
export type { ClockMode } from './clock';
