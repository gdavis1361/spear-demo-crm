// Seed scenario types.
//
// A `Scenario` is a typed module that, given an RNG + clock, writes a
// deterministic sequence of domain events to an EventLog. Scenarios
// compose: declare `extends: [...]` to run other scenarios first. The
// runner topologically sorts the chain and each layer gets a *forked*
// RNG derived from its name, so adding/removing a sibling layer doesn't
// perturb unrelated layers' output.

import type { EventLog } from '../domain/events';
import type { PromiseStore } from '../domain/promises';
import type { Rng } from './rng';
import type { VirtualClock, ClockMode } from './clock';

/**
 * Store-level APIs the scenarios are allowed to call. These are the same
 * typed entry points the app uses in prod — scenarios go through them so
 * every event a seed writes is one the projection already knows how to
 * consume.
 *
 * New stores are added here as scenarios grow; keep this narrow.
 */
export interface ScenarioStores {
  readonly promiseStore: PromiseStore;
}

export type ScenarioName = string & { readonly __brand: 'ScenarioName' };
export const scenarioName = (s: string): ScenarioName => s as ScenarioName;

export interface Scenario {
  readonly name: ScenarioName;
  /**
   * Event-payload schema version this scenario targets. The runner refuses
   * to run a scenario whose version is greater than the current schema;
   * emits `seed.scenario_stale` and continues when it's less.
   */
  readonly schemaVersion: number;
  readonly defaultRngSeed: number;
  readonly description: string;
  readonly tags?: readonly string[];
  /** Other scenarios to run first, in order. Cycles throw at resolve time. */
  readonly extends?: readonly ScenarioName[];
  /** Populate the event log. */
  build(ctx: ScenarioCtx): Promise<void>;
  /** Optional: assert post-conditions after this layer runs. */
  invariants?(ctx: InvariantCtx): Promise<void>;
}

export interface ScenarioCtx {
  readonly log: EventLog;
  readonly stores: ScenarioStores;
  readonly rng: Rng;
  readonly clock: VirtualClock;
  /** The full layer chain, including this one as the last element. */
  readonly layerPath: readonly ScenarioName[];
  /**
   * Deterministic idempotency key for a given `step`. Stable across runs
   * with the same (scenario, rngSeed, layer, step). Use this as the
   * `opKey` field on every event the scenario writes so re-running is a
   * UNIQUE-index dedupe rather than a duplicate-entity insert.
   *
   * Pure function of inputs — does not consume RNG state.
   */
  opKey(step: string | number): string;
}

export interface InvariantCtx {
  readonly log: EventLog;
  readonly stores: ScenarioStores;
  readonly clock: VirtualClock;
}

export interface RunScenarioOptions {
  /** Overrides scenario.defaultRngSeed. */
  rngSeed?: number;
  /** Defaults to a new `relative` clock. */
  clock?: VirtualClock;
  /**
   * Run each layer's `invariants()` after its `build()`. Default `true`
   * for the CLI + tests (where a failing invariant is a useful signal);
   * set to `false` from the runtime boot path so a user with slightly
   * drifted local state doesn't break their app startup on a scenario
   * consistency check.
   */
  runInvariants?: boolean;
}

export interface ScenarioResult {
  readonly scenario: ScenarioName;
  readonly rngSeed: number;
  readonly clockMode: ClockMode;
  readonly builtAt: string;
  /** Topological order of layers executed (base → leaf). */
  readonly layers: readonly ScenarioName[];
  readonly elapsedMs: number;
}

export interface ScenarioDescriptor {
  readonly name: ScenarioName;
  readonly schemaVersion: number;
  readonly defaultRngSeed: number;
  readonly description: string;
  readonly tags: readonly string[];
  readonly extends: readonly ScenarioName[];
  readonly hasInvariants: boolean;
}
