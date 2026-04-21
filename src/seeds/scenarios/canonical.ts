// Canonical demo scenario. Ports the former `seedFixturesIfEmpty()` in
// `src/app/runtime.ts` into a typed, registered, replayable scenario.
//
// Output shape is deliberately byte-stable against the prior hardcoded
// version so visual snapshots and behavioral tests don't churn in
// Phase 1. Later phases can expand (add Deals, Accounts, Signals) by
// adding layers that `extends: ['canonical']`.

import { CURRENT_SCHEMA_VERSION } from '../runner';
import { scenarioName, type Scenario } from '../types';
import { instant } from '../../lib/time';
import { repId } from '../../lib/ids';

export const canonicalScenario: Scenario = {
  name: scenarioName('canonical'),
  schemaVersion: CURRENT_SCHEMA_VERSION,
  defaultRngSeed: 1,
  description:
    'Default demo: five promises with the historical variety of due windows. ' +
    'Same shape as the pre-seed-system runtime fixtures.',
  tags: ['baseline', 'demo', 'rep-role'],
  async build({ stores, clock }) {
    // Idempotent: if the canonical promises already exist, this is a
    // no-op because PromiseStore.create dedupes on id.
    if (stores.promiseStore.list().length > 0) return;
    const me = repId('rep_mhall');
    const minsFromNow = (min: number) => instant(clock.minutesFromNow(min).toISOString());

    await stores.promiseStore.create({
      id: 'pr_alvarez',
      noun: { kind: 'person', id: 'ssgt-marcus-alvarez' },
      text: 'Call R. Alvarez — new delivery window',
      dueAt: minsFromNow(14),
      escalateAt: minsFromNow(45),
      createdBy: me,
    });
    await stores.promiseStore.create({
      id: 'pr_tle',
      noun: { kind: 'doc', id: 'mv-30418' },
      text: 'Send TLE paperwork · MV-30418',
      dueAt: minsFromNow(180),
      escalateAt: minsFromNow(360),
      createdBy: me,
    });
    await stores.promiseStore.create({
      id: 'pr_bafo_mels',
      noun: { kind: 'account', id: 'acc-1188' },
      text: 'BAFO response to MELS Corporate',
      dueAt: minsFromNow(-30),
      escalateAt: minsFromNow(-5),
      createdBy: me,
    });
    await stores.promiseStore.create({
      id: 'pr_park',
      noun: { kind: 'person', id: 'cw3-diane-park' },
      text: 'Follow-up to CW3 Park re: Alaska gap',
      dueAt: minsFromNow(60 * 24 * 4),
      createdBy: me,
    });
    await stores.promiseStore.create({
      id: 'pr_thibault',
      noun: { kind: 'person', id: 'm-thibault' },
      text: 'Intro call w/ M. Thibault (Atlas regional)',
      dueAt: minsFromNow(60 * 24 * 9),
      createdBy: me,
    });
  },
  async invariants({ stores }) {
    const list = stores.promiseStore.list();
    if (list.length < 5) {
      throw new Error(`canonical scenario invariant: expected ≥5 promises, found ${list.length}`);
    }
    if (!list.some((p) => p.id === 'pr_bafo_mels')) {
      throw new Error('canonical scenario invariant: missing pr_bafo_mels (overdue promise)');
    }
  },
};
