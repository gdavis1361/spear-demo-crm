import { describe, it, expect, beforeEach } from 'vitest';
import { vacuumOnce, vacuumAll, ttlForStream, DEFAULT_POLICIES } from './retention';
import { InMemoryEventLog, scheduleStream, workflowRunStream, type StreamKey } from './events';
import { instant } from '../lib/time';
import { ulid } from '../lib/ulid';

describe('vacuumOnce', () => {
  let log: InMemoryEventLog;
  beforeEach(() => {
    log = new InMemoryEventLog();
  });

  it('returns 0 deleted when nothing has expired', async () => {
    const stream = scheduleStream('milmove.cycle');
    const at = instant('2026-04-21T13:47:00Z');
    await log.append(stream, [
      { opKey: ulid(), payload: { kind: 'schedule.run_started', at, scheduledFor: at } },
    ]);
    const r = await vacuumOnce(
      log,
      { prefix: 'schedule:', ttlMs: 7 * 24 * 60 * 60 * 1000 },
      Date.parse(at.iso)
    );
    expect(r.deleted).toBe(0);
    expect(r.scanned).toBe(1);
  });

  it('classifies events older than ttl as expired', async () => {
    const stream = scheduleStream('s');
    // Old event: 10 days ago
    const oldAt = Date.parse('2026-04-11T00:00:00Z');
    const newAt = Date.parse('2026-04-21T00:00:00Z');
    await log.append(stream, [
      {
        opKey: 'k1',
        payload: {
          kind: 'schedule.run_started',
          at: { iso: new Date(oldAt).toISOString() },
          scheduledFor: { iso: new Date(oldAt).toISOString() },
        },
      },
    ]);
    await log.append(stream, [
      {
        opKey: 'k2',
        payload: {
          kind: 'schedule.run_started',
          at: { iso: new Date(newAt).toISOString() },
          scheduledFor: { iso: new Date(newAt).toISOString() },
        },
      },
    ]);
    const deleted: string[] = [];
    const r = await vacuumOnce(
      log,
      { prefix: 'schedule:', ttlMs: 7 * 24 * 60 * 60 * 1000 },
      newAt,
      async (ids) => {
        for (const id of ids) deleted.push(id);
      }
    );
    expect(r.scanned).toBe(2);
    expect(r.deleted).toBe(1);
    expect(deleted).toHaveLength(1);
  });

  it('respects batchSize', async () => {
    const stream = scheduleStream('s');
    const oldAt = Date.parse('2026-04-01T00:00:00Z');
    for (let i = 0; i < 10; i++) {
      await log.append(stream, [
        {
          opKey: `k${i}`,
          payload: {
            kind: 'schedule.run_started',
            at: { iso: new Date(oldAt + i).toISOString() },
            scheduledFor: { iso: new Date(oldAt).toISOString() },
          },
        },
      ]);
    }
    const r = await vacuumOnce(
      log,
      { prefix: 'schedule:', ttlMs: 1, batchSize: 3 },
      Date.now(),
      async () => undefined
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
    // TB7 added 90d per-kind policies for account + deal streams.
    expect(ttlForStream('account:acc_1' as StreamKey)).toBe(90 * 24 * 60 * 60 * 1000);
    expect(ttlForStream('deal:ld_1' as StreamKey)).toBe(90 * 24 * 60 * 60 * 1000);
  });
  it('returns null when no policy matches', () => {
    // Promise streams currently have no retention policy — row-level
    // `promises` store is lifecycle-managed by the promise domain, not
    // by stream vacuum.
    expect(ttlForStream('promise:pr_1' as StreamKey)).toBeNull();
  });
});

// T2 — completion-anchored retention. The contract: a workflow stream
// is never vacuumed before it has a `workflow.run_completed` event.
// Per-event TTL is wrong for workflows because a single run can span
// days/months (PCS cycle, quote re-engage waits for hours-to-days),
// and deleting the head of a still-active run breaks replay
// irrecoverably — there is no `run_started` to fold into the result.
describe('vacuumOnce stream-anchored (T2)', () => {
  let log: InMemoryEventLog;
  beforeEach(() => {
    log = new InMemoryEventLog();
  });

  const policy = {
    prefix: 'workflow:',
    ttlMs: 30 * 24 * 60 * 60 * 1000,
    completionKinds: ['workflow.run_completed'] as const,
  };

  it('never vacuums an active (un-completed) run even when its head is ancient', async () => {
    const stream = workflowRunStream('wf-pcs', 'r1');
    const longAgo = '2025-01-01T00:00:00Z';
    await log.append(stream, [
      {
        opKey: 'k1',
        payload: {
          kind: 'workflow.run_started',
          at: instant(longAgo),
          version: 1,
          trigger: 'manual',
        },
      },
    ]);
    await log.append(stream, [
      {
        opKey: 'k2',
        payload: {
          kind: 'workflow.wait_armed',
          at: instant(longAgo),
          stepIdx: 0,
          fireAt: instant('2026-04-21T12:00:00Z'),
          resumeOn: [],
        },
      },
    ]);
    const deleted: string[] = [];
    const r = await vacuumOnce(
      log,
      policy,
      Date.parse('2026-06-01T00:00:00Z'), // long after the old TTL cutoff
      async (ids) => {
        for (const id of ids) deleted.push(id);
      }
    );
    expect(r.deleted).toBe(0);
    expect(deleted).toHaveLength(0);
  });

  it('vacuums the whole stream when run_completed is older than ttl', async () => {
    const stream = workflowRunStream('wf-pcs', 'r2');
    const longAgo = '2026-01-01T00:00:00Z';
    await log.append(stream, [
      {
        opKey: 'k1',
        payload: {
          kind: 'workflow.run_started',
          at: instant(longAgo),
          version: 1,
          trigger: 'manual',
        },
      },
    ]);
    await log.append(stream, [
      {
        opKey: 'k2',
        payload: {
          kind: 'workflow.run_completed',
          at: instant(longAgo),
          disposition: 'queued',
        },
      },
    ]);
    const deleted: string[] = [];
    const r = await vacuumOnce(log, policy, Date.parse('2026-06-01T00:00:00Z'), async (ids) => {
      for (const id of ids) deleted.push(id);
    });
    expect(r.deleted).toBe(2); // both events in the stream
    expect(deleted).toHaveLength(2);
  });

  it('keeps a completed run whose completion is inside the retention window', async () => {
    const stream = workflowRunStream('wf-pcs', 'r3');
    const recent = '2026-04-20T00:00:00Z'; // day before "now"
    await log.append(stream, [
      {
        opKey: 'k1',
        payload: {
          kind: 'workflow.run_started',
          at: instant(recent),
          version: 1,
          trigger: 'manual',
        },
      },
    ]);
    await log.append(stream, [
      {
        opKey: 'k2',
        payload: { kind: 'workflow.run_completed', at: instant(recent), disposition: 'queued' },
      },
    ]);
    const deleted: string[] = [];
    const r = await vacuumOnce(log, policy, Date.parse('2026-04-21T00:00:00Z'), async (ids) => {
      for (const id of ids) deleted.push(id);
    });
    expect(r.deleted).toBe(0);
    expect(deleted).toHaveLength(0);
  });

  it('handles mixed streams: vacuums old-completed, keeps active + fresh-completed', async () => {
    // Old completed
    await log.append(workflowRunStream('wf', 'old'), [
      {
        opKey: 'a1',
        payload: {
          kind: 'workflow.run_started',
          at: instant('2025-12-01T00:00:00Z'),
          version: 1,
          trigger: 'manual',
        },
      },
    ]);
    await log.append(workflowRunStream('wf', 'old'), [
      {
        opKey: 'a2',
        payload: {
          kind: 'workflow.run_completed',
          at: instant('2025-12-01T00:00:00Z'),
          disposition: 'queued',
        },
      },
    ]);
    // Active (waiting)
    await log.append(workflowRunStream('wf', 'active'), [
      {
        opKey: 'b1',
        payload: {
          kind: 'workflow.run_started',
          at: instant('2025-12-01T00:00:00Z'),
          version: 1,
          trigger: 'manual',
        },
      },
    ]);
    // Fresh completed
    await log.append(workflowRunStream('wf', 'fresh'), [
      {
        opKey: 'c1',
        payload: {
          kind: 'workflow.run_started',
          at: instant('2026-04-15T00:00:00Z'),
          version: 1,
          trigger: 'manual',
        },
      },
    ]);
    await log.append(workflowRunStream('wf', 'fresh'), [
      {
        opKey: 'c2',
        payload: {
          kind: 'workflow.run_completed',
          at: instant('2026-04-15T00:00:00Z'),
          disposition: 'queued',
        },
      },
    ]);
    const r = await vacuumOnce(
      log,
      policy,
      Date.parse('2026-04-21T00:00:00Z'),
      async () => undefined
    );
    expect(r.deleted).toBe(2); // only the two 'old' events
    expect(r.scanned).toBe(5);
  });
});

// TB7 — per-kind retention lets a policy trim PII-bearing payload
// kinds (message bodies, quote text) while leaving structural events
// untouched. The compensating control for keeping IndexedDB
// unencrypted at rest: old PII drops out of local storage even when
// the rest of the account history stays readable.
describe('vacuumOnce per-kind retention (TB7)', () => {
  it('evicts filtered kinds past ttl; leaves other kinds in the same stream alone', async () => {
    const log = new InMemoryEventLog();
    const stream = 'account:acc_x' as StreamKey;
    // Mix: message_sent (PII), signal_fired (structural),
    // meeting_held (structural). Only message_sent is eligible.
    await log.append(stream, [
      {
        opKey: 'k_msg',
        payload: {
          kind: 'account.message_sent',
          at: instant('2025-12-01T00:00:00Z'),
          by: 'rep_mhall',
          body: 'top-secret negotiation text',
        },
      },
    ]);
    await log.append(stream, [
      {
        opKey: 'k_sig',
        payload: {
          kind: 'account.signal_fired',
          at: instant('2025-12-01T00:00:00Z'),
          signalId: 'sig_abc',
        },
      },
    ]);
    await log.append(stream, [
      {
        opKey: 'k_meet',
        payload: {
          kind: 'account.meeting_held',
          at: instant('2025-12-01T00:00:00Z'),
          attendees: ['per_1'],
          durationMin: 30,
        },
      },
    ]);

    const policy = {
      prefix: 'account:',
      ttlMs: 90 * 24 * 60 * 60 * 1000,
      perEventKinds: ['account.message_sent'] as const,
    };
    const deleted: string[] = [];
    const r = await vacuumOnce(
      log,
      policy,
      Date.parse('2026-12-01T00:00:00Z'), // well past 90 days
      async (ids) => {
        for (const id of ids) deleted.push(id);
      }
    );
    expect(r.scanned).toBe(3);
    expect(r.deleted).toBe(1);
    // The deleted row must be the message_sent event, not one of the
    // structural kinds.
    const all = await log.read(stream);
    const msgEvent = all.find((e) => e.payload.kind === 'account.message_sent');
    expect(deleted).toEqual([msgEvent?.id]);
  });

  it('keeps PII bodies inside the retention window', async () => {
    const log = new InMemoryEventLog();
    await log.append('account:acc_y' as StreamKey, [
      {
        opKey: 'k',
        payload: {
          kind: 'account.message_sent',
          at: instant('2026-04-01T00:00:00Z'),
          by: 'rep_mhall',
          body: 'recent text',
        },
      },
    ]);
    const policy = {
      prefix: 'account:',
      ttlMs: 90 * 24 * 60 * 60 * 1000,
      perEventKinds: ['account.message_sent'] as const,
    };
    const r = await vacuumOnce(
      log,
      policy,
      Date.parse('2026-04-21T00:00:00Z'), // only 20 days later
      async () => undefined
    );
    expect(r.deleted).toBe(0);
  });
});

describe('DEFAULT_POLICIES shape (TB7)', () => {
  it('includes a per-kind policy for account message bodies', () => {
    const accountPolicy = DEFAULT_POLICIES.find((p) => p.prefix === 'account:');
    expect(accountPolicy).toBeDefined();
    expect(accountPolicy?.perEventKinds).toContain('account.message_sent');
    expect(accountPolicy?.perEventKinds).toContain('account.message_received');
    expect(accountPolicy?.ttlMs).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('includes a per-kind policy for deal quote text', () => {
    const dealPolicy = DEFAULT_POLICIES.find((p) => p.prefix === 'deal:');
    expect(dealPolicy).toBeDefined();
    expect(dealPolicy?.perEventKinds).toContain('deal.quote_sent');
  });
});
