import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventLog, dealStream, type StreamKey } from './events';
import { instant } from '../lib/time';
import { repId, leadId } from '../lib/ids';
import { moneyFromMajor } from '../lib/money';
import { ulid } from '../lib/ulid';

const at = instant('2026-04-21T13:47:00Z');
const me = repId('rep_mhall');
const ld = leadId('ld_40218');

describe('InMemoryEventLog v2', () => {
  let log: InMemoryEventLog;
  beforeEach(() => {
    log = new InMemoryEventLog();
  });

  it('append validates payload via Zod and rejects malformed input', async () => {
    const stream = dealStream(ld);
    const r = await log.append(stream, [
      // Missing `value` — Zod rejects.
      { opKey: 'k1', payload: { kind: 'deal.created', at, by: me, stage: 'inbound' } as never },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_payload');
  });

  it('append rejects an illegal advance edge via the schema CHECK constraint', async () => {
    const stream = dealStream(ld);
    const r = await log.append(stream, [
      {
        opKey: 'k1',
        payload: { kind: 'deal.advanced', at, by: me, from: 'inbound', to: 'won' },
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid_payload');
      expect(r.message).toMatch(/illegal advance edge/);
    }
  });

  it('assigns ULIDs and per-stream seqs', async () => {
    const stream = dealStream(ld);
    const r1 = await log.append(stream, [
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
    const r2 = await log.append(stream, [
      {
        opKey: ulid(),
        payload: { kind: 'deal.advanced', at, by: me, from: 'inbound', to: 'qualify' },
      },
    ]);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.events[0].seq).toBe(1);
    expect(r2.events[0].seq).toBe(2);
    expect(r1.events[0].id.length).toBe(26);
    expect(r1.events[0].id < r2.events[0].id).toBe(true); // ULIDs sort
  });

  it('reads stream events in chronological (ULID) order', async () => {
    const stream = dealStream(ld);
    await log.append(stream, [
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
    await log.append(stream, [
      {
        opKey: ulid(),
        payload: { kind: 'deal.advanced', at, by: me, from: 'inbound', to: 'qualify' },
      },
    ]);
    const back = await log.read(stream);
    expect(back).toHaveLength(2);
    expect(back[0].payload.kind).toBe('deal.created');
    expect(back[1].payload.kind).toBe('deal.advanced');
    expect(back[0].id < back[1].id).toBe(true);
  });

  it('UNIQUE (stream, opKey): same opKey returns the prior result idempotently', async () => {
    const stream = dealStream(ld);
    const r1 = await log.append(stream, [
      {
        opKey: 'fixed-key',
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
    const r2 = await log.append(stream, [
      {
        opKey: 'fixed-key',
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
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok) throw new Error('first append should succeed');
    if (!(r2.ok && 'idempotent' in r2)) throw new Error('expected idempotent response');
    expect(r2.idempotent).toBe(true);
    expect(r2.events[0].id).toBe(r1.events[0].id);
    expect(await log.size()).toBe(1); // exactly one row
  });

  it('readPrefix matches a namespace', async () => {
    const a = 'deal:ld_a' as StreamKey;
    const b = 'deal:ld_b' as StreamKey;
    const p = 'promise:pr_x' as StreamKey;
    await log.append(a, [
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
    await log.append(b, [
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
    await log.append(p, [
      { opKey: ulid(), payload: { kind: 'promise.created', at, by: me, text: 't', dueAt: at } },
    ]);
    expect(await log.readPrefix('deal:')).toHaveLength(2);
    expect(await log.readPrefix('promise:')).toHaveLength(1);
  });

  it('appendIf with a stale predicate returns optimistic_lock_failure', async () => {
    const stream = dealStream(ld);
    await log.append(stream, [
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
    const r = await log.appendIf(
      stream,
      [
        {
          opKey: ulid(),
          payload: { kind: 'deal.advanced', at, by: me, from: 'inbound', to: 'qualify' },
        },
      ],
      () => false // simulate "state changed since read"
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('optimistic_lock_failure');
  });

  it('subscribe fires after each successful append', async () => {
    const stream = dealStream(ld);
    const calls: number[] = [];
    const off = log.subscribe(({ ids }) => calls.push(ids.length));
    await log.append(stream, [
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
    off();
    expect(calls).toEqual([1]);
  });

  it('clear empties the log', async () => {
    const stream = dealStream(ld);
    await log.append(stream, [
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
    await log.clear();
    expect(await log.size()).toBe(0);
  });
});
