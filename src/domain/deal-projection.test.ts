import { describe, it, expect } from 'vitest';
import { InMemoryEventLog, dealStream } from './events';
import { DealProjection } from './deal-projection';
import { instant } from '../lib/time';
import { leadId, repId } from '../lib/ids';
import { moneyFromMajor } from '../lib/money';
import type { StageKey } from '../lib/types';

const me = repId('rep_mhall');
const at = instant('2026-04-21T10:00:00Z');

function creationPayload(stage: StageKey = 'inbound') {
  return {
    kind: 'deal.created' as const,
    at,
    by: me,
    stage,
    value: moneyFromMajor(1, 'USD'),
    displayId: 'LD-TEST',
    title: 'Test Deal',
    meta: '',
    branch: 'Army',
    tags: ['PCS'],
  };
}

describe('DealProjection', () => {
  it('is empty after constructing on an empty log', async () => {
    const log = new InMemoryEventLog();
    const p = new DealProjection(log);
    await p.ready;
    expect(p.list()).toEqual([]);
  });

  it('folds deal.created into the projection', async () => {
    const log = new InMemoryEventLog();
    const id = leadId('ld_1');
    await log.append(dealStream(id), [{ opKey: 'k1', payload: creationPayload('inbound') }]);

    const p = new DealProjection(log);
    await p.ready;

    const list = p.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('Test Deal');
    expect(list[0]!.stage).toBe('inbound');
    expect(list[0]!.tags).toEqual(['PCS']);
  });

  it('reflects deal.advanced / deal.reverted', async () => {
    const log = new InMemoryEventLog();
    const id = leadId('ld_2');
    const stream = dealStream(id);
    await log.append(stream, [{ opKey: 'k1', payload: creationPayload('inbound') }]);
    await log.append(stream, [
      {
        opKey: 'k2',
        payload: { kind: 'deal.advanced', at, by: me, from: 'inbound', to: 'qualify' },
      },
    ]);
    await log.append(stream, [
      {
        opKey: 'k3',
        payload: {
          kind: 'deal.reverted',
          at,
          by: me,
          from: 'qualify',
          to: 'inbound',
          reason: 'rolled back',
        },
      },
    ]);

    const p = new DealProjection(log);
    await p.ready;

    expect(p.list()[0]!.stage).toBe('inbound');
  });

  it('deal.signed snaps to stage=won', async () => {
    const log = new InMemoryEventLog();
    const id = leadId('ld_3');
    const stream = dealStream(id);
    await log.append(stream, [{ opKey: 'k1', payload: creationPayload('verbal') }]);
    await log.append(stream, [
      { opKey: 'k2', payload: { kind: 'deal.signed', at, by: me, contractId: 'c1' } },
    ]);

    const p = new DealProjection(log);
    await p.ready;

    expect(p.list()[0]!.stage).toBe('won');
  });

  it('listByStage filters to the requested stage', async () => {
    const log = new InMemoryEventLog();
    await log.append(dealStream(leadId('ld_a')), [
      { opKey: 'k1', payload: { ...creationPayload('inbound'), displayId: 'LD-A' } },
    ]);
    await log.append(dealStream(leadId('ld_b')), [
      { opKey: 'k2', payload: { ...creationPayload('qualify'), displayId: 'LD-B' } },
    ]);
    await log.append(dealStream(leadId('ld_c')), [
      { opKey: 'k3', payload: { ...creationPayload('qualify'), displayId: 'LD-C' } },
    ]);

    const p = new DealProjection(log);
    await p.ready;

    expect(p.listByStage('qualify').map((d) => d.displayId)).toEqual(['LD-B', 'LD-C']);
    expect(p.listByStage('inbound')).toHaveLength(1);
    expect(p.listByStage('won')).toEqual([]);
  });

  it('subscribe fires immediately with the current snapshot', async () => {
    const log = new InMemoryEventLog();
    await log.append(dealStream(leadId('ld_x')), [
      { opKey: 'k1', payload: creationPayload('inbound') },
    ]);

    const p = new DealProjection(log);
    await p.ready;

    let received: readonly unknown[] | null = null;
    const unsubscribe = p.subscribe((snap) => {
      received = snap;
    });
    expect(received).not.toBeNull();
    expect(received!).toHaveLength(1);
    unsubscribe();
  });

  it('subscribe re-emits after a new append is observed via the log subscription', async () => {
    const log = new InMemoryEventLog();
    const p = new DealProjection(log);
    await p.ready;

    const calls: number[] = [];
    p.subscribe((snap) => calls.push(snap.length));
    // Initial call with empty snapshot.
    expect(calls).toEqual([0]);

    await log.append(dealStream(leadId('ld_y')), [
      { opKey: 'k1', payload: creationPayload('inbound') },
    ]);

    // Yield so the async subscription handler runs.
    await new Promise((r) => setTimeout(r, 0));

    expect(calls[calls.length - 1]).toBe(1);
  });

  it('rehydrate rebuilds from the log after cache clear', async () => {
    const log = new InMemoryEventLog();
    await log.append(dealStream(leadId('ld_z')), [
      { opKey: 'k1', payload: creationPayload('inbound') },
    ]);

    const p = new DealProjection(log);
    await p.ready;
    expect(p.list()).toHaveLength(1);

    p.clearCache();
    expect(p.list()).toHaveLength(0);
    await p.rehydrate();
    expect(p.list()).toHaveLength(1);
  });

  it('getById returns the deal or null', async () => {
    const log = new InMemoryEventLog();
    const id = leadId('ld_byid');
    await log.append(dealStream(id), [{ opKey: 'k1', payload: creationPayload('scoping') }]);

    const p = new DealProjection(log);
    await p.ready;

    expect(p.getById(id)?.stage).toBe('scoping');
    expect(p.getById(leadId('ld_missing'))).toBeNull();
  });

  it('preserves insertion order across stages (Map-backed)', async () => {
    // Ordering is by ULID (= append order), not by stage index. Tests that
    // the snapshot matches the order deals were seeded, so Pipeline's
    // kanban + table render byte-identically vs. the pre-projection static
    // DEALS array.
    const log = new InMemoryEventLog();
    await log.append(dealStream(leadId('ld_1')), [
      { opKey: 'k1', payload: { ...creationPayload('won'), displayId: 'LD-1' } },
    ]);
    await log.append(dealStream(leadId('ld_2')), [
      { opKey: 'k2', payload: { ...creationPayload('inbound'), displayId: 'LD-2' } },
    ]);
    await log.append(dealStream(leadId('ld_3')), [
      { opKey: 'k3', payload: { ...creationPayload('inbound'), displayId: 'LD-3' } },
    ]);

    const p = new DealProjection(log);
    await p.ready;

    expect(p.list().map((d) => d.displayId)).toEqual(['LD-1', 'LD-2', 'LD-3']);
  });

  it('stage change via advance keeps the deal in its original list position', async () => {
    const log = new InMemoryEventLog();
    const stream1 = dealStream(leadId('ld_1'));
    const stream2 = dealStream(leadId('ld_2'));
    await log.append(stream1, [
      { opKey: 'k1', payload: { ...creationPayload('inbound'), displayId: 'LD-A' } },
    ]);
    await log.append(stream2, [
      { opKey: 'k2', payload: { ...creationPayload('inbound'), displayId: 'LD-B' } },
    ]);
    await log.append(stream1, [
      {
        opKey: 'k3',
        payload: { kind: 'deal.advanced', at, by: me, from: 'inbound', to: 'qualify' },
      },
    ]);

    const p = new DealProjection(log);
    await p.ready;
    // LD-A moved to qualify but still comes first in the snapshot.
    expect(p.list().map((d) => d.displayId)).toEqual(['LD-A', 'LD-B']);
    expect(p.list()[0]!.stage).toBe('qualify');
  });
});
