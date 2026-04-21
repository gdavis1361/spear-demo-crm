import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vacuumNow } from './vacuum-runner';
import { IndexedDbEventLog, scheduleStream, openSpearDb, _resetDbConnectionForTests } from './events';
import { ulid } from '../lib/ulid';

const STORE = 'events';

async function clearEvents(): Promise<void> {
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('vacuumNow (real IDB deleter)', () => {
  let log: IndexedDbEventLog;

  beforeEach(async () => {
    _resetDbConnectionForTests();
    await clearEvents();
    log = new IndexedDbEventLog();
  });
  afterEach(async () => {
    await clearEvents();
  });

  it('actually deletes expired schedule events from IDB', async () => {
    const stream = scheduleStream('milmove.cycle');
    const oldAt = Date.parse('2026-01-01T00:00:00Z'); // way old
    const newAt = Date.parse('2026-04-21T00:00:00Z'); // current

    await log.append(stream, [{
      opKey: ulid(),
      payload: { kind: 'schedule.run_started', at: { iso: new Date(oldAt).toISOString() }, scheduledFor: { iso: new Date(oldAt).toISOString() } },
    }]);
    await log.append(stream, [{
      opKey: ulid(),
      payload: { kind: 'schedule.run_started', at: { iso: new Date(newAt).toISOString() }, scheduledFor: { iso: new Date(newAt).toISOString() } },
    }]);
    expect(await log.size()).toBe(2);

    const report = await vacuumNow(log, [{ prefix: 'schedule:', ttlMs: 7 * 24 * 60 * 60 * 1000 }], newAt);
    expect(report.totalDeleted).toBe(1);
    expect(await log.size()).toBe(1); // only the new one survived

    // The remaining row is the new one — verify by reading
    const back = await log.read(stream);
    expect(back).toHaveLength(1);
    expect(back[0].payload.kind).toBe('schedule.run_started');
  });

  it('reports zero deleted when nothing has expired', async () => {
    const report = await vacuumNow(log, [{ prefix: 'schedule:', ttlMs: 7 * 24 * 60 * 60 * 1000 }]);
    expect(report.totalDeleted).toBe(0);
  });

  it('tolerates an empty event log', async () => {
    const report = await vacuumNow(log);
    expect(report.totalDeleted).toBe(0);
    expect(report.results.length).toBeGreaterThan(0);
  });
});
