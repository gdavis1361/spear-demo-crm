import { describe, it, expect } from 'vitest';
import { previewAction, applyAction } from './action-runner';
import { ontology } from './spear';

const REP_CTX = { clearance: 'high' as const, projects: [], actorId: 'rep_mhall' };
const LOW_CTX = { clearance: 'low' as const, projects: [], actorId: 'rep_mhall' };

describe('previewAction', () => {
  it('returns ok with diff + side effects for a legal advance', () => {
    const r = previewAction(
      ontology, 'deal.advance',
      { kind: 'deal', stage: 'qualify', title: 't', value: { amountMinor: 0n, currency: 'USD' } },
      { to: 'scoping' },
      REP_CTX,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.preview.diff).toEqual({ stage: { from: 'qualify', to: 'scoping' } });
      expect(r.preview.sideEffects.length).toBeGreaterThan(0);
    }
  });

  it('refuses an illegal transition with a precondition_failed code', () => {
    const r = previewAction(
      ontology, 'deal.advance',
      { kind: 'deal', stage: 'inbound', title: 't', value: { amountMinor: 0n, currency: 'USD' } },
      { to: 'won' },
      REP_CTX,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('precondition_failed');
  });

  it('refuses an unknown action', () => {
    const r = previewAction(ontology, 'deal.unicorn', { kind: 'deal', stage: 'inbound', title: 't', value: { amountMinor: 0n, currency: 'USD' } }, { to: 'qualify' }, REP_CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_action');
  });

  it('refuses when action marking exceeds viewer clearance', () => {
    const r = previewAction(
      ontology, 'deal.send_bafo',
      { kind: 'deal', stage: 'quote', title: 't', value: { amountMinor: 0n, currency: 'USD' } },
      { text: 'a long enough body to pass any text validation' },
      LOW_CTX,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission_denied');
  });

  it('refuses an action against a wrong object kind', () => {
    const r = previewAction(ontology, 'deal.advance', { kind: 'account', stage: 'qualify' } as never, { to: 'scoping' }, REP_CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong_object_kind');
  });
});

describe('applyAction', () => {
  it('returns ok when preview passes', async () => {
    const r = await applyAction(
      ontology, 'deal.advance',
      { kind: 'deal', stage: 'qualify', title: 't', value: { amountMinor: 0n, currency: 'USD' } },
      { to: 'scoping' },
      REP_CTX,
    );
    expect(r.ok).toBe(true);
  });

  it('refuses to apply when preview fails', async () => {
    const r = await applyAction(
      ontology, 'deal.advance',
      { kind: 'deal', stage: 'inbound', title: 't', value: { amountMinor: 0n, currency: 'USD' } },
      { to: 'won' },
      REP_CTX,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('precondition_failed');
  });
});
