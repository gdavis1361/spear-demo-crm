import { describe, it, expect, afterEach } from 'vitest';
import { InMemoryEventLog } from '../domain/events';
import { PromiseStore } from '../domain/promises';
import { registry } from './registry';
import { runScenario, CURRENT_SCHEMA_VERSION } from './runner';
import { scenarioName, type Scenario } from './types';
import { _unregisterAllForTests, registerAllScenarios } from './scenarios';

function buildStores() {
  const log = new InMemoryEventLog();
  const promiseStore = new PromiseStore(log);
  return { log, stores: { promiseStore } as const };
}

describe('runScenario', () => {
  afterEach(() => {
    _unregisterAllForTests();
  });

  it('runs a single scenario end-to-end + returns a descriptor', async () => {
    const calls: string[] = [];
    const s: Scenario = {
      name: scenarioName('test-basic'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 7,
      description: 't',
      async build() {
        calls.push('build');
      },
    };
    registry.register(s);
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    const result = await runScenario(log, stores, scenarioName('test-basic'));
    expect(calls).toEqual(['build']);
    expect(result.scenario).toBe('test-basic');
    expect(result.rngSeed).toBe(7);
    expect(result.layers).toEqual(['test-basic']);
    expect(result.clockMode).toBe('relative');
  });

  it('runs extended scenarios in topological order (base → leaf)', async () => {
    const order: string[] = [];
    registry.register({
      name: scenarioName('base'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      async build() {
        order.push('base');
      },
    });
    registry.register({
      name: scenarioName('mid'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      extends: [scenarioName('base')],
      async build() {
        order.push('mid');
      },
    });
    registry.register({
      name: scenarioName('leaf'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      extends: [scenarioName('mid')],
      async build() {
        order.push('leaf');
      },
    });
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    const result = await runScenario(log, stores, scenarioName('leaf'));
    expect(order).toEqual(['base', 'mid', 'leaf']);
    expect(result.layers).toEqual(['base', 'mid', 'leaf']);
  });

  it('detects cycles in the extends graph', async () => {
    registry.register({
      name: scenarioName('cycle-a'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      extends: [scenarioName('cycle-b')],
      async build() {},
    });
    registry.register({
      name: scenarioName('cycle-b'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      extends: [scenarioName('cycle-a')],
      async build() {},
    });
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await expect(runScenario(log, stores, scenarioName('cycle-a'))).rejects.toThrow(
      /scenario cycle detected/
    );
  });

  it('refuses a scenario declaring a future schemaVersion', async () => {
    registry.register({
      name: scenarioName('from-the-future'),
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      defaultRngSeed: 1,
      description: '',
      async build() {},
    });
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await expect(runScenario(log, stores, scenarioName('from-the-future'))).rejects.toThrow(
      /from the future|bump SNAPSHOT_SCHEMA_VERSION/i
    );
  });

  it('runs stale scenarios (older schemaVersion) without throwing', async () => {
    if (CURRENT_SCHEMA_VERSION <= 1) return; // can't test if we're at v1
    let built = false;
    registry.register({
      name: scenarioName('stale'),
      schemaVersion: CURRENT_SCHEMA_VERSION - 1,
      defaultRngSeed: 1,
      description: '',
      async build() {
        built = true;
      },
    });
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await runScenario(log, stores, scenarioName('stale'));
    expect(built).toBe(true);
  });

  it('forks RNG per layer so adjacent layers pull from independent streams', async () => {
    const observed: Record<string, number> = {};
    registry.register({
      name: scenarioName('a'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 42,
      description: '',
      async build({ rng }) {
        observed.a = rng.next();
      },
    });
    registry.register({
      name: scenarioName('b'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 42,
      description: '',
      extends: [scenarioName('a')],
      async build({ rng }) {
        observed.b = rng.next();
      },
    });
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await runScenario(log, stores, scenarioName('b'));
    expect(observed.a).not.toBe(observed.b);
  });

  it('honors rngSeed override from options', async () => {
    let seen = 0;
    registry.register({
      name: scenarioName('seed-sensitive'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      async build({ rng }) {
        seen = rng.intBetween(0, 1_000_000);
      },
    });
    const a = buildStores();
    const b = buildStores();
    await a.stores.promiseStore.ready;
    await b.stores.promiseStore.ready;
    await runScenario(a.log, a.stores, scenarioName('seed-sensitive'), { rngSeed: 123 });
    const x = seen;
    await runScenario(b.log, b.stores, scenarioName('seed-sensitive'), { rngSeed: 123 });
    expect(seen).toBe(x);
    await runScenario(b.log, b.stores, scenarioName('seed-sensitive'), { rngSeed: 999 });
    expect(seen).not.toBe(x);
  });

  it('ctx.opKey is deterministic and independent of RNG consumption', async () => {
    const keys: string[][] = [];
    registry.register({
      name: scenarioName('opkey-test'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 100,
      description: '',
      async build({ rng, opKey }) {
        // Interleave RNG picks with opKey calls. The opKey output should
        // be stable across runs because it doesn't consume RNG state.
        const round: string[] = [];
        round.push(opKey('alpha'));
        rng.next(); // perturb the RNG
        round.push(opKey('beta'));
        rng.intBetween(0, 100);
        round.push(opKey('alpha')); // same step → same key
        keys.push(round);
      },
    });
    const a = buildStores();
    const b = buildStores();
    await a.stores.promiseStore.ready;
    await b.stores.promiseStore.ready;
    await runScenario(a.log, a.stores, scenarioName('opkey-test'));
    await runScenario(b.log, b.stores, scenarioName('opkey-test'));
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[0]![0]).toBe(keys[0]![2]); // same step reuses key
    expect(keys[0]![0]).not.toBe(keys[0]![1]); // different steps differ
    expect(keys[0]![0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ctx.opKey changes when rngSeed changes', async () => {
    const keys: string[] = [];
    registry.register({
      name: scenarioName('opkey-seed-sensitive'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      async build({ opKey }) {
        keys.push(opKey('step-x'));
      },
    });
    const a = buildStores();
    const b = buildStores();
    await a.stores.promiseStore.ready;
    await b.stores.promiseStore.ready;
    await runScenario(a.log, a.stores, scenarioName('opkey-seed-sensitive'), { rngSeed: 1 });
    await runScenario(b.log, b.stores, scenarioName('opkey-seed-sensitive'), { rngSeed: 2 });
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('runInvariants:false skips invariant checks', async () => {
    let invariantCalled = false;
    registry.register({
      name: scenarioName('skip-invariants'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      async build() {},
      async invariants() {
        invariantCalled = true;
        throw new Error('should not run');
      },
    });
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    // With invariants disabled, the bad invariant is never called.
    await runScenario(log, stores, scenarioName('skip-invariants'), { runInvariants: false });
    expect(invariantCalled).toBe(false);
    // With default (invariants enabled), it throws.
    await expect(runScenario(log, stores, scenarioName('skip-invariants'))).rejects.toThrow(
      'should not run'
    );
  });

  it('invariant failures propagate as rejected promises', async () => {
    registry.register({
      name: scenarioName('bad-invariant'),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultRngSeed: 1,
      description: '',
      async build() {},
      async invariants() {
        throw new Error('invariant broken');
      },
    });
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await expect(runScenario(log, stores, scenarioName('bad-invariant'))).rejects.toThrow(
      'invariant broken'
    );
  });
});

describe('canonical scenario (smoke)', () => {
  afterEach(() => _unregisterAllForTests());
  it('seeds 5 promises including the overdue pr_bafo_mels', async () => {
    registerAllScenarios();
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await runScenario(log, stores, scenarioName('canonical'));
    const list = stores.promiseStore.list();
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list.map((p) => p.id)).toContain('pr_bafo_mels');
  });

  it('is idempotent: re-running keeps the same count', async () => {
    registerAllScenarios();
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await runScenario(log, stores, scenarioName('canonical'));
    const count1 = stores.promiseStore.list().length;
    await runScenario(log, stores, scenarioName('canonical'));
    expect(stores.promiseStore.list().length).toBe(count1);
  });
});
