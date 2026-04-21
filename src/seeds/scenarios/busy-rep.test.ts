import { describe, it, expect, afterEach } from 'vitest';
import { InMemoryEventLog } from '../../domain/events';
import { PromiseStore } from '../../domain/promises';
import { DealProjection } from '../../domain/deal-projection';
import { registry } from '../registry';
import { runScenario } from '../runner';
import { scenarioName } from '../types';
import { _unregisterAllForTests, registerAllScenarios } from '.';

function buildStores() {
  const log = new InMemoryEventLog();
  const promiseStore = new PromiseStore(log);
  return { log, stores: { promiseStore } as const };
}

describe('busy-rep scenario', () => {
  afterEach(() => _unregisterAllForTests());

  it('registers under the expected name with busy-rep tags', () => {
    registerAllScenarios();
    const desc = registry.describe(scenarioName('busy-rep'));
    expect(desc.name).toBe('busy-rep');
    expect(desc.tags).toContain('stress');
    expect(desc.tags).toContain('overdues');
    expect(desc.hasInvariants).toBe(true);
  });

  it('produces ≥25 deals spanning every stage', async () => {
    registerAllScenarios();
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await runScenario(log, stores, scenarioName('busy-rep'));

    const dealEvents = await log.readPrefix('deal:');
    const created = dealEvents.filter((e) => e.payload.kind === 'deal.created');
    expect(created.length).toBeGreaterThanOrEqual(25);

    const stages = new Set<string>();
    for (const e of created) if (e.payload.kind === 'deal.created') stages.add(e.payload.stage);
    for (const s of ['inbound', 'qualify', 'scoping', 'quote', 'verbal', 'won']) {
      expect(stages.has(s)).toBe(true);
    }
  });

  it('produces the full promise-status matrix', async () => {
    registerAllScenarios();
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await runScenario(log, stores, scenarioName('busy-rep'));

    const ps = stores.promiseStore.list();
    expect(ps.length).toBeGreaterThanOrEqual(25);
    expect(ps.filter((p) => p.status === 'kept').length).toBeGreaterThanOrEqual(3);
    // Overdues + escalations + missed together should be at least the
    // 8 we seeded with negative dueInMinutes (ticker may have flipped
    // a few already).
    const pastDue = ps.filter(
      (p) =>
        ['pending', 'missed', 'escalated'].includes(p.status) && new Date(p.dueAt.iso) < new Date()
    );
    expect(pastDue.length).toBeGreaterThanOrEqual(8);
  });

  it('invariants pass when the scenario runs clean', async () => {
    registerAllScenarios();
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await expect(runScenario(log, stores, scenarioName('busy-rep'))).resolves.toBeDefined();
  });

  it("DealProjection renders the scenario's deals across every stage", async () => {
    registerAllScenarios();
    const { log, stores } = buildStores();
    await stores.promiseStore.ready;
    await runScenario(log, stores, scenarioName('busy-rep'));

    const projection = new DealProjection(log);
    await projection.ready;
    expect(projection.list().length).toBeGreaterThanOrEqual(25);
    for (const s of ['inbound', 'qualify', 'scoping', 'quote', 'verbal', 'won'] as const) {
      expect(projection.listByStage(s).length).toBeGreaterThan(0);
    }
  });

  it('is deterministic given the same rngSeed', async () => {
    registerAllScenarios();

    const runOnce = async (): Promise<string[]> => {
      const { log, stores } = buildStores();
      await stores.promiseStore.ready;
      await runScenario(log, stores, scenarioName('busy-rep'), { rngSeed: 7 });
      const events = await log.readPrefix('deal:');
      return events
        .filter((e) => e.payload.kind === 'deal.created')
        .map((e) => (e.payload.kind === 'deal.created' ? e.payload.title : ''));
    };

    const a = await runOnce();
    const b = await runOnce();
    expect(a).toEqual(b);
  });

  it('different rngSeeds produce different title sets', async () => {
    registerAllScenarios();
    const withSeed = async (s: number) => {
      const { log, stores } = buildStores();
      await stores.promiseStore.ready;
      await runScenario(log, stores, scenarioName('busy-rep'), { rngSeed: s });
      const events = await log.readPrefix('deal:');
      return new Set(
        events
          .filter((e) => e.payload.kind === 'deal.created')
          .map((e) => (e.payload.kind === 'deal.created' ? e.payload.title : ''))
      );
    };
    const a = await withSeed(1);
    const b = await withSeed(2);
    // At least one title should differ between runs.
    let differ = false;
    for (const t of a) {
      if (!b.has(t)) {
        differ = true;
        break;
      }
    }
    expect(differ).toBe(true);
  });
});
