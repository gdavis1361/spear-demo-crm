import { describe, it, expect } from 'vitest';
import { accountActivity, dealCurrentStage, dealStageHistory } from './projections';
import { dealStream, accountStream, type StreamKey, type StoredEvent } from './events';
import { instant } from '../lib/time';
import { repId, leadId, accountId, personId, signalId, docId } from '../lib/ids';
import { moneyFromMajor } from '../lib/money';

const me = repId('rep_mhall');
const ld = leadId('ld_40218');
const acc = accountId('acc_1188');

function makeStored(seq: number, stream: StreamKey, payload: unknown): StoredEvent {
  return {
    id: String(seq).padStart(26, '0'), // dummy ULID-shape; sort order is irrelevant for these tests
    seq,
    opKey: `op_${seq}`,
    stream,
    payload: payload as StoredEvent['payload'],
  };
}

describe('accountActivity', () => {
  it('returns empty for an empty stream', () => {
    expect(accountActivity([])).toEqual([]);
  });

  it('newest-first ordering across kinds', () => {
    const stream = accountStream(acc);
    const events: StoredEvent[] = [
      makeStored(1, stream, {
        kind: 'account.message_received',
        at: instant('2026-04-21T10:00:00Z'),
        from: personId('per_kruiz'),
        body: 'a',
        stream,
      }),
      makeStored(2, stream, {
        kind: 'account.message_sent',
        at: instant('2026-04-21T11:00:00Z'),
        by: me,
        body: 'b',
        stream,
      }),
      makeStored(3, stream, {
        kind: 'account.file_uploaded',
        at: instant('2026-04-21T12:00:00Z'),
        by: me,
        docId: docId('doc_1'),
        size: 1024,
        stream,
      }),
    ];
    const items = accountActivity(events);
    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe('File');
    expect(items[2].kind).toBe('Message'); // oldest = received
  });

  it('renders signal, meeting, claim entries', () => {
    const stream = accountStream(acc);
    const events: StoredEvent[] = [
      makeStored(1, stream, {
        kind: 'account.signal_fired',
        at: instant('2026-04-21T10:00:00Z'),
        signalId: signalId('sig_001'),
        stream,
      }),
      makeStored(2, stream, {
        kind: 'account.meeting_held',
        at: instant('2026-04-21T10:30:00Z'),
        attendees: [personId('per_a')],
        durationMin: 45,
        stream,
      }),
      makeStored(3, stream, {
        kind: 'account.claim_resolved',
        at: instant('2026-04-21T11:00:00Z'),
        claimId: 'cl_1',
        resolvedInMs: 36 * 3_600_000,
        stream,
      }),
    ];
    const items = accountActivity(events);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain('Signal');
    expect(kinds).toContain('Meeting');
    expect(kinds).toContain('Claim');
  });

  it('ignores non-account events', () => {
    const stream = dealStream(ld);
    const events: StoredEvent[] = [
      makeStored(1, stream, {
        kind: 'deal.created',
        at: instant('2026-04-21T10:00:00Z'),
        by: me,
        stage: 'inbound',
        value: moneyFromMajor(1, 'USD'),
        displayId: 'LD-T',
        title: 'T',
        meta: '',
        branch: 'T',
        tags: [],
        stream,
      }),
    ];
    expect(accountActivity(events)).toEqual([]);
  });
});

describe('dealCurrentStage', () => {
  it('returns null on empty events', () => {
    expect(dealCurrentStage([])).toBeNull();
  });

  it('uses deal.created as the initial stage', () => {
    const stream = dealStream(ld);
    const events: StoredEvent[] = [
      makeStored(1, stream, {
        kind: 'deal.created',
        at: instant('2026-04-21T10:00:00Z'),
        by: me,
        stage: 'qualify',
        value: moneyFromMajor(1, 'USD'),
        stream,
      }),
    ];
    expect(dealCurrentStage(events)).toBe('qualify');
  });

  it('reflects the latest advanced/reverted', () => {
    const stream = dealStream(ld);
    const events: StoredEvent[] = [
      makeStored(1, stream, {
        kind: 'deal.created',
        at: instant('2026-04-21T10:00:00Z'),
        by: me,
        stage: 'inbound',
        value: moneyFromMajor(1, 'USD'),
        displayId: 'LD-T',
        title: 'T',
        meta: '',
        branch: 'T',
        tags: [],
        stream,
      }),
      makeStored(2, stream, {
        kind: 'deal.advanced',
        at: instant('2026-04-21T10:30:00Z'),
        by: me,
        from: 'inbound',
        to: 'qualify',
        stream,
      }),
      makeStored(3, stream, {
        kind: 'deal.advanced',
        at: instant('2026-04-21T11:00:00Z'),
        by: me,
        from: 'qualify',
        to: 'scoping',
        stream,
      }),
      makeStored(4, stream, {
        kind: 'deal.reverted',
        at: instant('2026-04-21T11:30:00Z'),
        by: me,
        from: 'scoping',
        to: 'qualify',
        reason: 'rolled back',
        stream,
      }),
    ];
    expect(dealCurrentStage(events)).toBe('qualify');
  });

  it('signed → won', () => {
    const stream = dealStream(ld);
    const events: StoredEvent[] = [
      makeStored(1, stream, {
        kind: 'deal.created',
        at: instant('2026-04-21T10:00:00Z'),
        by: me,
        stage: 'verbal',
        value: moneyFromMajor(1, 'USD'),
        stream,
      }),
      makeStored(2, stream, {
        kind: 'deal.signed',
        at: instant('2026-04-21T10:30:00Z'),
        by: me,
        contractId: 'k_1',
        stream,
      }),
    ];
    expect(dealCurrentStage(events)).toBe('won');
  });
});

describe('dealStageHistory', () => {
  it('returns only advance + revert events with the right flag', () => {
    const stream = dealStream(ld);
    const events: StoredEvent[] = [
      makeStored(1, stream, {
        kind: 'deal.created',
        at: instant('2026-04-21T10:00:00Z'),
        by: me,
        stage: 'inbound',
        value: moneyFromMajor(1, 'USD'),
        displayId: 'LD-T',
        title: 'T',
        meta: '',
        branch: 'T',
        tags: [],
        stream,
      }),
      makeStored(2, stream, {
        kind: 'deal.advanced',
        at: instant('2026-04-21T10:30:00Z'),
        by: me,
        from: 'inbound',
        to: 'qualify',
        stream,
      }),
      makeStored(3, stream, {
        kind: 'deal.reverted',
        at: instant('2026-04-21T11:00:00Z'),
        by: me,
        from: 'qualify',
        to: 'inbound',
        reason: 'oops',
        stream,
      }),
    ];
    const h = dealStageHistory(events);
    expect(h).toHaveLength(2);
    expect(h[0].reverted).toBe(false);
    expect(h[1].reverted).toBe(true);
  });
});
