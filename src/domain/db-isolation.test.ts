// Gate 1 (Phase 3 PR 1): two named IndexedDB instances must be isolated.
// Appending to one must not be visible from the other. If this test ever
// goes red, DO NOT ship — the seed-scenario safety contract depends on it.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  IndexedDbEventLog,
  dealStream,
  _setDbNameForTests,
  _resetDbConnectionForTests,
} from './events';
import { instant } from '../lib/time';
import { repId, leadId } from '../lib/ids';
import { moneyFromMajor } from '../lib/money';
import { ulid } from '../lib/ulid';

const at = instant('2026-04-21T13:47:00Z');
const me = repId('rep_mhall');

async function clearDb(name: string): Promise<void> {
  _setDbNameForTests(name);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  _resetDbConnectionForTests();
}

describe('named IndexedDB isolation (Phase 3 PR 1 — Gate 1)', () => {
  beforeEach(async () => {
    await clearDb('spear-events');
    await clearDb('spear-events-seed-test');
  });

  it('two EventLogs on different DB names share no state', async () => {
    const ld = leadId('ld_gate1');
    const makeCreate = () => ({
      opKey: ulid(),
      payload: {
        kind: 'deal.created' as const,
        at,
        by: me,
        stage: 'inbound' as const,
        value: moneyFromMajor(1, 'USD'),
        displayId: 'LD-G1',
        title: 'Gate 1',
        meta: '',
        branch: 'Army',
        tags: ['PCS'],
      },
    });

    // Open DB #1 (the user's real DB) and write a deal.
    _setDbNameForTests('spear-events');
    const realLog = new IndexedDbEventLog();
    const r1 = await realLog.append(dealStream(ld), [makeCreate()]);
    expect(r1.ok).toBe(true);
    expect((await realLog.readPrefix('deal:')).length).toBe(1);

    // Switch to DB #2 (a seed-scenario DB). Expect empty.
    _resetDbConnectionForTests();
    _setDbNameForTests('spear-events-seed-test');
    const seedLog = new IndexedDbEventLog();
    expect((await seedLog.readPrefix('deal:')).length).toBe(0);

    // Write a different deal to the seed DB.
    const seedPayload = {
      ...makeCreate().payload,
      displayId: 'LD-G1-SEED',
      title: 'Gate 1 seed',
    };
    await seedLog.append(dealStream(leadId('ld_gate1_seed')), [
      { opKey: ulid(), payload: seedPayload },
    ]);
    expect((await seedLog.readPrefix('deal:')).length).toBe(1);
    expect((await seedLog.readPrefix('deal:'))[0]!.payload.kind).toBe('deal.created');

    // Switch back to the real DB — the seed deal is not visible.
    _resetDbConnectionForTests();
    _setDbNameForTests('spear-events');
    const realLog2 = new IndexedDbEventLog();
    const realDeals = await realLog2.readPrefix('deal:');
    expect(realDeals).toHaveLength(1);
    if (realDeals[0]!.payload.kind === 'deal.created') {
      expect(realDeals[0]!.payload.displayId).toBe('LD-G1');
      expect(realDeals[0]!.payload.displayId).not.toBe('LD-G1-SEED');
    } else {
      throw new Error('expected deal.created payload');
    }
  });
});
