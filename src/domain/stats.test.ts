import { describe, it, expect, beforeEach } from 'vitest';
import { getStorageStats, recordVacuumOutcome } from './stats';
import { IndexedDbEventLog, dealStream, scheduleStream, openSpearDb, _resetDbConnectionForTests, STORE_PROMISES } from './events';
import { instant } from '../lib/time';
import { repId, leadId } from '../lib/ids';
import { moneyFromMajor } from '../lib/money';
import { ulid } from '../lib/ulid';

const me = repId('rep_mhall');
const ld = leadId('ld_40218');
const at = instant('2026-04-21T13:47:00Z');

async function clearAll(): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['events', 'events_dlq', STORE_PROMISES], 'readwrite');
    tx.objectStore('events').clear();
    tx.objectStore('events_dlq').clear();
    tx.objectStore(STORE_PROMISES).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('getStorageStats', () => {
  let log: IndexedDbEventLog;

  beforeEach(async () => {
    _resetDbConnectionForTests();
    await clearAll();
    log = new IndexedDbEventLog();
  });

  it('returns zeroed stats for an empty database', async () => {
    const s = await getStorageStats(log);
    expect(s.events.total).toBe(0);
    expect(s.events.dlq).toBe(0);
    expect(s.promises.total).toBe(0);
    expect(s.promises.byStatus).toEqual({ pending: 0, kept: 0, missed: 0, escalated: 0 });
  });

  it('counts events per prefix', async () => {
    await log.append(dealStream(ld), [{
      opKey: ulid(),
      payload: { kind: 'deal.created', at, by: me, stage: 'inbound', value: moneyFromMajor(1) },
    }]);
    await log.append(scheduleStream('s'), [{
      opKey: ulid(),
      payload: { kind: 'schedule.run_started', at, scheduledFor: at },
    }]);
    const s = await getStorageStats(log);
    expect(s.events.total).toBe(2);
    expect(s.events.byPrefix['deal:']).toBe(1);
    expect(s.events.byPrefix['schedule:']).toBe(1);
  });

  it('records and returns the last vacuum outcome', async () => {
    recordVacuumOutcome('2026-04-21T14:00:00Z', 7);
    const s = await getStorageStats(log);
    expect(s.lastVacuum).toEqual({ at: '2026-04-21T14:00:00Z', totalDeleted: 7 });
  });
});
