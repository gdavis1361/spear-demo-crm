// Scenario runner.
//
// Given a scenario name, resolves the `extends` chain into a topological
// order, forks an RNG per layer, and runs each layer's `build()` against
// the provided EventLog. Emits telemetry around the whole run so seeded
// sessions are distinguishable from real traffic.
//
// Schema-version policy (both lock + auto-migrate, per plan):
//   - scenario.schemaVersion > current  → refuse (scenario is from the future)
//   - scenario.schemaVersion < current  → emit `seed.scenario_stale` + run
//   - scenario.schemaVersion === current → run clean

import type { EventLog } from '../domain/events';
// TODO(event-schema-version): `SNAPSHOT_SCHEMA_VERSION` tracks the snapshot
// wrapper format (takenAt, count, events) and happens to drift in lockstep
// with the event payload schema today. When the two must diverge, add a
// dedicated `EVENT_SCHEMA_VERSION` constant in `event-schema.ts` and import
// it here instead. One-line change; no behavior impact today.
import { SNAPSHOT_SCHEMA_VERSION as CURRENT_SCHEMA_VERSION } from '../domain/snapshot';
import { track } from '../app/telemetry';
import { VirtualClock } from './clock';
import { Rng } from './rng';
import { registry } from './registry';
import type {
  RunScenarioOptions,
  Scenario,
  ScenarioCtx,
  ScenarioName,
  ScenarioResult,
  ScenarioStores,
} from './types';

export { CURRENT_SCHEMA_VERSION };

/**
 * Deterministic 16-char hex idempotency key. Pure function of inputs:
 * the same (rngSeed, layer, step) triple always produces the same opKey,
 * independent of how many RNG picks the scenario has made up to that
 * point. Uses two FNV-1a 32-bit rounds with distinct basis values so the
 * result has full 64-bit spread.
 *
 * This is the key that goes on `AppendInput.opKey`, paired with the
 * stream's `UNIQUE (stream, opKey)` index — re-running the same scenario
 * is a dedupe, not a duplicate.
 */
function deriveOpKey(rngSeed: number, layer: ScenarioName, step: string | number): string {
  const payload = `${rngSeed}:${layer}:${String(step)}`;
  const FNV_PRIME = 0x01000193;
  const a = fnv32(0x811c9dc5, payload, FNV_PRIME);
  const b = fnv32(0x1c9dc581, payload, FNV_PRIME);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function fnv32(basis: number, s: string, prime: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, prime) >>> 0;
  }
  return h >>> 0;
}

/**
 * Run a scenario (and any it extends) against `log`.
 */
export async function runScenario(
  log: EventLog,
  stores: ScenarioStores,
  name: ScenarioName,
  opts: RunScenarioOptions = {}
): Promise<ScenarioResult> {
  const scenario = registry.get(name);
  const rngSeed = opts.rngSeed ?? scenario.defaultRngSeed;
  const clock = opts.clock ?? new VirtualClock({ mode: 'relative' });
  const layers = resolveLayerChain(scenario);

  checkSchemaVersion(scenario);

  track({
    name: 'seed.started',
    props: {
      scenario: scenario.name,
      rngSeed,
      clockMode: clock.mode,
      layers: layers.map((l) => l.name).join(','),
    },
  });

  const runInvariants = opts.runInvariants ?? true;
  const started = performance.now();
  const baseRng = new Rng(rngSeed);
  for (const layer of layers) {
    const ctx: ScenarioCtx = {
      log,
      stores,
      rng: baseRng.fork(layer.name),
      clock,
      layerPath: layers.slice(0, layers.indexOf(layer) + 1).map((l) => l.name),
      opKey: (step) => deriveOpKey(rngSeed, layer.name, step),
    };
    await layer.build(ctx);
    if (runInvariants && layer.invariants) {
      await layer.invariants({ log, stores, clock });
    }
  }
  const elapsedMs = Math.round(performance.now() - started);
  const builtAt = clock.nowIso();

  const result: ScenarioResult = {
    scenario: scenario.name,
    rngSeed,
    clockMode: clock.mode,
    builtAt,
    layers: layers.map((l) => l.name),
    elapsedMs,
  };

  track({
    name: 'seed.completed',
    props: {
      scenario: scenario.name,
      rngSeed,
      layers: result.layers.join(','),
      elapsedMs,
    },
  });

  return result;
}

/**
 * Topologically sort the `extends` chain starting from `root`, with the
 * root appearing last. Cycles throw.
 */
function resolveLayerChain(root: Scenario): readonly Scenario[] {
  const visited = new Set<ScenarioName>();
  const onPath = new Set<ScenarioName>();
  const order: Scenario[] = [];

  const visit = (s: Scenario): void => {
    if (visited.has(s.name)) return;
    if (onPath.has(s.name)) {
      throw new Error(
        `scenario cycle detected involving "${s.name}" (path: ${Array.from(onPath).join(' → ')})`
      );
    }
    onPath.add(s.name);
    for (const dep of s.extends ?? []) {
      visit(registry.get(dep));
    }
    onPath.delete(s.name);
    visited.add(s.name);
    order.push(s);
  };

  visit(root);
  return order;
}

function checkSchemaVersion(scenario: Scenario): void {
  if (scenario.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `scenario "${scenario.name}" declares schemaVersion ${scenario.schemaVersion} but current schema is ${CURRENT_SCHEMA_VERSION}. ` +
        `Either the scenario is from the future or you need to bump SNAPSHOT_SCHEMA_VERSION.`
    );
  }
  if (scenario.schemaVersion < CURRENT_SCHEMA_VERSION) {
    track({
      name: 'seed.scenario_stale',
      props: {
        scenario: scenario.name,
        declaredVersion: scenario.schemaVersion,
        currentVersion: CURRENT_SCHEMA_VERSION,
      },
    });
    // Continue: the scenario may still produce valid output; the telemetry
    // event is the signal that it should be refreshed.
  }
}
