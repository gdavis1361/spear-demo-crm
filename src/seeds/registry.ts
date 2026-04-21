// Central map of scenario name → Scenario. Registration is explicit in
// `scenarios/index.ts` so tree-shaking stays predictable and scenarios
// never leak into prod bundles via accident.

import type { Scenario, ScenarioDescriptor, ScenarioName } from './types';

class ScenarioRegistry {
  private map = new Map<string, Scenario>();

  register(scenario: Scenario): void {
    if (this.map.has(scenario.name)) {
      throw new Error(`scenario "${scenario.name}" already registered`);
    }
    this.map.set(scenario.name, scenario);
  }

  get(name: ScenarioName): Scenario {
    const s = this.map.get(name);
    if (!s) throw new Error(`unknown scenario "${name}" (registered: ${this.list().join(', ')})`);
    return s;
  }

  has(name: ScenarioName): boolean {
    return this.map.has(name);
  }

  list(): readonly ScenarioName[] {
    return Array.from(this.map.keys()).sort() as ScenarioName[];
  }

  describe(name: ScenarioName): ScenarioDescriptor {
    const s = this.get(name);
    return {
      name: s.name,
      schemaVersion: s.schemaVersion,
      defaultRngSeed: s.defaultRngSeed,
      description: s.description,
      tags: s.tags ?? [],
      extends: s.extends ?? [],
      hasInvariants: typeof s.invariants === 'function',
    };
  }

  describeAll(): readonly ScenarioDescriptor[] {
    return this.list().map((n) => this.describe(n));
  }

  /** Test-only reset. */
  _reset(): void {
    this.map.clear();
  }
}

export const registry = new ScenarioRegistry();
