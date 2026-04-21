import { describe, it, expect, beforeEach } from 'vitest';
import { vacuumOnce, vacuumAll, ttlForStream, DEFAULT_POLICIES } from './retention';
import { InMemoryEventLog, scheduleStream, type StreamKey } from './events';
import { instant } from '../lib/time';
import { ulid } from '../lib/ulid';

describe('vacuumOnce', () => {
  let log: InMemoryEventLog;
  beforeEach(() => { log = new InMemoryEventLog(); });

  it('returns 0 deleted when nothing has expired', async () => {
    const stream = scheduleStream('milmove.cycle');
    const at = instant('2026-04-21T13:47:00Z');
    await log.append(stream, [{ opKey: ulid(), payload: { kind: 'schedule.run_started', at, scheduledFor: at } }]);
    const r = await vacuumOnce(log, { prefix: 'schedule:', ttlMs: 7 * 24 * 60 * 60 * 1000 }, Date.parse(at.iso));
    expect(r.deleted).toBe(0);
    expect(r.scanned).toBe(1);
  });

  it('classifies events older than ttl as expired', async () => {
    const stream = scheduleStream('s');
    // Old event: 10 days ago
    const oldAt = Date.parse('2026-04-11T00:00:00Z');
    const newAt = Date.parse('2026-04-21T00:00:00Z');
    await log.append(stream, [
      { opKey: 'k1', payload: { kind: 'schedule.run_started', at: { iso: new Date(oldAt).toISOString() }, scheduledFor: { iso: new Date(oldAt).toISOString() } } },
    ]);
    await log.append(stream, [
      { opKey: 'k2', payload: { kind: 'schedule.run_started', at: { iso: new Date(newAt).toISOString() }, scheduledFor: { iso: new Date(newAt).toISOString() } } },
    ]);
    const deleted: string[] = [];
    const r = await vacuumOnce(
      log,
      { prefix: 'schedule:', ttlMs: 7 * 24 * 60 * 60 * 1000 },
      newAt,
      async (ids) => { for (const id of ids) deleted.push(id); }
    );
    expect(r.scanned).toBe(2);
    expect(r.deleted).toBe(1);
    expect(deleted).toHaveLength(1);
  });

  it('respects batchSize', async () => {
    const stream = scheduleStream('s');
    const oldAt = Date.parse('2026-04-01T00:00:00Z');
    for (let i = 0; i < 10; i++) {
      await log.append(stream, [{
        opKey: `k${i}`,
        payload: { kind: 'schedule.run_started', at: { iso: new Date(oldAt + i).toISOString() }, scheduledFor: { iso: new Date(oldAt).toISOString() } },
      }]);
    }
    const r = await vacuumOnce(
      log,
      { prefix: 'schedule:', ttlMs: 1, batchSize: 3 },
      Date.now(),
      async () => undefined,
    );
    expect(r.deleted).toBe(3);
  });
});

describe('vacuumAll', () => {
  it('runs every policy and returns one record per prefix', async () => {
    const log = new InMemoryEventLog();
    const r = await vacuumAll(log, DEFAULT_POLICIES, Date.now(), async () => undefined);
    expect(r).toHaveLength(DEFAULT_POLICIES.length);
    for (const item of r) expect(item.deleted).toBe(0);
  });
});

describe('ttlForStream', () => {
  it('matches the configured prefix', () => {
    expect(ttlForStream('schedule:milmove.cycle' as StreamKey)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(ttlForStream('workflow:wf-1:run:r1' as StreamKey)).toBe(30 * 24 * 60 * 60 * 1000);
  });
  it('returns null when no policy matches', () => {
    expect(ttlForStream('deal:ld_1' as StreamKey)).toBeNull();
  });
});
