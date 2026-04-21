// The "first-login" scenario: no entities. Exercises empty-state UI.
//
// This is the useful-baseline for every other scenario that wants to
// start from nothing. It's a no-op at runtime but declaring it explicitly
// lets tests say `test.use({ seed: 'empty' })` and get guaranteed
// isolation.

import { CURRENT_SCHEMA_VERSION } from '../runner';
import { scenarioName, type Scenario } from '../types';

export const emptyScenario: Scenario = {
  name: scenarioName('empty'),
  schemaVersion: CURRENT_SCHEMA_VERSION,
  defaultRngSeed: 0,
  description: 'No entities. Exercises the empty-state UI paths.',
  tags: ['baseline', 'empty-state'],
  async build() {
    // Intentionally blank.
  },
  async invariants({ stores }) {
    if (stores.promiseStore.list().length !== 0) {
      throw new Error('empty scenario invariant: promiseStore should be empty');
    }
  },
};
