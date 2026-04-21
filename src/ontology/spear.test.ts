import { describe, it, expect } from 'vitest';
import { ontology } from './spear';

describe('Spear ontology', () => {
  it('declares the six core object types', () => {
    const expected = ['person', 'account', 'deal', 'base', 'signal', 'promise'];
    for (const k of expected) expect(ontology.objectTypes.has(k)).toBe(true);
  });

  it('Person.account has an inverse Account.persons', () => {
    const personLinks = ontology.objectTypes.get('person')?.links;
    expect(personLinks?.account).toMatchObject({ to: 'account', cardinality: 'one', inverse: 'persons' });

    // The inverseLinks index is the queryable form of "what points at me"
    const accountInverse = ontology.inverseLinks.get('account');
    expect(accountInverse?.some((l) => l.fromKind === 'person' && l.fromLinkName === 'account')).toBe(true);
  });

  it('Deal.signals points to Signal.deal — bidirectional', () => {
    expect(ontology.objectTypes.get('deal')?.links?.signals?.to).toBe('signal');
    expect(ontology.objectTypes.get('signal')?.links?.deal?.to).toBe('deal');
  });

  it('actionsFor("deal") includes advance + send_bafo', () => {
    const ids = ontology.actionsFor('deal').map((a) => a.id);
    expect(ids).toContain('deal.advance');
    expect(ids).toContain('deal.send_bafo');
  });

  it('Person.email is marked `high` (PII)', () => {
    expect(ontology.property('person', 'email')?.marking).toBe('high');
  });

  it('Deal.bafoDraft is marked `high`', () => {
    expect(ontology.property('deal', 'bafoDraft')?.marking).toBe('high');
  });
});
