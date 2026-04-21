import { describe, it, expect, beforeEach } from 'vitest';
import { canTransition, transitionKind, runTransition, currentStage, TRANSITIONS } from './deal-machine';
import { dealStream, InMemoryEventLog } from './events';
import { instant } from '../lib/time';
import { repId, leadId } from '../lib/ids';
import { moneyFromMajor } from '../lib/money';
import type { StageKey } from '../lib/types';

const me = repId('rep_mhall');
const ld = leadId('ld_40218');
const at = instant('2026-04-21T13:47:00Z');

describe('canTransition()', () => {
  const allow: Array<[StageKey, StageKey]> = [
    ['inbound', 'qualify'],
    ['qualify', 'scoping'],
    ['scoping', 'quote'],
    ['quote', 'verbal'],
    ['verbal', 'won'],
    // Allowed reverts
    ['qualify', 'inbound'],
    ['scoping', 'qualify'],
    ['quote', 'scoping'],
    ['verbal', 'quote'],
  ];
  it.each(allow)('%s → %s is legal', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const reject: Array<[StageKey, StageKey]> = [
    ['inbound', 'won'],
    ['inbound', 'verbal'],
    ['qualify', 'won'],
    ['won', 'qualify'],     // terminal cannot revert
    ['won', 'inbound'],
    ['scoping', 'won'],
    ['scoping', 'verbal'],
  ];
  it.each(reject)('%s → %s is illegal', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('graph contains every StageKey as a key', () => {
    const keys: StageKey[] = ['inbound', 'qualify', 'scoping', 'quote', 'verbal', 'won'];
    for (const k of keys) expect(TRANSITIONS[k]).toBeDefined();
  });
});

describe('transitionKind()', () => {
  it('classifies forward edges', () => {
    expect(transitionKind('inbound', 'qualify')).toBe('advanced');
    expect(transitionKind('verbal', 'won')).toBe('advanced');
  });
  it('classifies revert edges', () => {
    expect(transitionKind('verbal', 'quote')).toBe('reverted');
    expect(transitionKind('qualify', 'inbound')).toBe('reverted');
  });
});

describe('runTransition()', () => {
  let log: InMemoryEventLog;
  beforeEach(() => { log = new InMemoryEventLog(); });

  it('appends a deal.advanced event for a forward transition', async () => {
    const res = await runTransition(log, { id: ld, from: 'inbound', to: 'qualify', by: me, role: 'rep' }, at);
    expect(res.ok).toBe(true);
    const events = await log.read(dealStream(ld));
    expect(events).toHaveLength(1);
    expect(events[0].payload.kind).toBe('deal.advanced');
  });

  it('appends a deal.reverted event for a backward transition', async () => {
    const res = await runTransition(log, { id: ld, from: 'verbal', to: 'quote', by: me, role: 'rep', reason: 're-quote' }, at);
    expect(res.ok).toBe(true);
    const e = (await log.read(dealStream(ld)))[0];
    expect(e.payload.kind).toBe('deal.reverted');
  });

  it('refuses an illegal transition with stage_transition_invalid', async () => {
    const res = await runTransition(log, { id: ld, from: 'inbound', to: 'won', by: me, role: 'rep' }, at);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('stage_transition_invalid');
      expect(res.message).toMatch(/inbound → won/);
    }
    expect(await log.size()).toBe(0);
  });

  it('refuses a no-op transition', async () => {
    const res = await runTransition(log, { id: ld, from: 'qualify', to: 'qualify', by: me, role: 'rep' }, at);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('stage_transition_invalid');
  });
});

describe('currentStage() projection', () => {
  it('returns null on empty events', () => {
    expect(currentStage([])).toBeNull();
  });

  it('reflects the latest transition', async () => {
    const log = new InMemoryEventLog();
    const stream = dealStream(ld);
    await log.append(stream, [
      { kind: 'deal.created', at, by: me, stage: 'inbound', value: moneyFromMajor(1, 'USD'), stream } as never,
    ]);
    await runTransition(log, { id: ld, from: 'inbound', to: 'qualify', by: me, role: 'rep' }, at);
    await runTransition(log, { id: ld, from: 'qualify', to: 'scoping', by: me, role: 'rep' }, at);
    const events = await log.read(stream);
    expect(currentStage(events)).toBe('scoping');
  });
});
