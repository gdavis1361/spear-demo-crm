import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportSnapshot,
  validateSnapshot,
  previewImport,
  SNAPSHOT_SCHEMA_VERSION,
} from './snapshot';
import { InMemoryEventLog, dealStream, accountStream } from './events';
import { instant } from '../lib/time';
import { repId, leadId, accountId, personId } from '../lib/ids';
import { moneyFromMajor } from '../lib/money';
import { ulid } from '../lib/ulid';

const me = repId('rep_mhall');
const ld = leadId('ld_40218');
const acc = accountId('acc_1188');
const at = instant('2026-04-21T13:47:00Z');

describe('exportSnapshot', () => {
  let log: InMemoryEventLog;
  beforeEach(() => {
    log = new InMemoryEventLog();
  });

  it('returns an empty document on a fresh log', async () => {
    const snap = await exportSnapshot(log);
    expect(snap.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snap.count).toBe(0);
    expect(snap.events).toEqual([]);
  });

  it('captures events from every namespace, sorted by ULID', async () => {
    await log.append(dealStream(ld), [
      {
        opKey: ulid(),
        payload: {
          kind: 'deal.created',
          at,
          by: me,
          stage: 'inbound',
          value: moneyFromMajor(1),
          displayId: 'LD-T',
          title: 'T',
          meta: '',
          branch: 'T',
          tags: [],
        },
      },
    ]);
    await log.append(accountStream(acc), [
      {
        opKey: ulid(),
        payload: { kind: 'account.message_received', at, from: personId('per_kruiz'), body: 'hi' },
      },
    ]);

    const snap = await exportSnapshot(log);
    expect(snap.count).toBe(2);
    // Sorted by id ULID order
    const ids = snap.events.map((e) => (e as { id: string }).id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

describe('validateSnapshot', () => {
  it('rejects non-objects', () => {
    expect(validateSnapshot(null).ok).toBe(false);
    expect(validateSnapshot(42).ok).toBe(false);
    expect(validateSnapshot('hi').ok).toBe(false);
  });

  it('rejects an unsupported schemaVersion', () => {
    const r = validateSnapshot({ schemaVersion: 99, takenAt: '', count: 0, events: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported/);
  });

  it('rejects a non-array events field', () => {
    const r = validateSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      takenAt: '',
      count: 0,
      events: 'nope',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a well-formed empty snapshot', () => {
    const r = validateSnapshot({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      takenAt: '',
      count: 0,
      events: [],
    });
    expect(r.ok).toBe(true);
  });
});

describe('previewImport', () => {
  it('counts accepted vs rejected envelopes', async () => {
    const log = new InMemoryEventLog();
    await log.append(dealStream(ld), [
      {
        opKey: ulid(),
        payload: {
          kind: 'deal.created',
          at,
          by: me,
          stage: 'inbound',
          value: moneyFromMajor(1),
          displayId: 'LD-T',
          title: 'T',
          meta: '',
          branch: 'T',
          tags: [],
        },
      },
    ]);
    const snap = await exportSnapshot(log);
    // Add a malformed event
    const tainted = {
      ...snap,
      events: [...snap.events, { id: 'NOPE', stream: 'deal:x', payload: { kind: 'whatever' } }],
    };
    const report = previewImport(tainted);
    expect(report.events.accepted).toBe(1);
    expect(report.events.rejected).toBe(1);
    expect(report.events.issues).toHaveLength(1);
  });
});
