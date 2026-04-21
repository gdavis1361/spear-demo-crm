import { describe, it, expect } from 'vitest';
import { defineOntology, type ActionTypeDefinition, type ObjectTypeDefinition } from './define';
import { stringProp } from './property-types';

const personOT: ObjectTypeDefinition = {
  kind: 'person', label: 'Person', primaryKey: 'id', marking: 'medium',
  properties: { id: stringProp({ label: 'ID', marking: 'low' }), name: stringProp({ label: 'Name', marking: 'medium' }) },
  links: { account: { to: 'account', cardinality: 'one', inverse: 'persons' } },
};
const accountOT: ObjectTypeDefinition = {
  kind: 'account', label: 'Account', primaryKey: 'id', marking: 'medium',
  properties: { id: stringProp({ label: 'ID', marking: 'low' }) },
  links: { persons: { to: 'person', cardinality: 'many', inverse: 'account' } },
};

describe('defineOntology', () => {
  it('builds and exposes object types by kind', () => {
    const o = defineOntology({ objectTypes: [personOT, accountOT], actionTypes: [] });
    expect(o.objectTypes.get('person')?.kind).toBe('person');
    expect(o.objectTypes.size).toBe(2);
  });

  it('rejects duplicate object types', () => {
    expect(() =>
      defineOntology({ objectTypes: [personOT, { ...personOT }], actionTypes: [] })
    ).toThrow(/duplicate object type/);
  });

  it('rejects link to undeclared kind', () => {
    const broken: ObjectTypeDefinition = {
      ...personOT,
      links: { ghost: { to: 'ghost', cardinality: 'one', inverse: 'p' } },
    };
    expect(() => defineOntology({ objectTypes: [broken], actionTypes: [] })).toThrow(/not a declared object type/);
  });

  it('builds inverse-link index', () => {
    const o = defineOntology({ objectTypes: [personOT, accountOT], actionTypes: [] });
    // person→account is registered as an inverse for account
    const inv = o.inverseLinks.get('account');
    expect(inv).toBeDefined();
    expect(inv?.find((l) => l.fromKind === 'person')).toMatchObject({
      fromKind: 'person', fromLinkName: 'account', cardinality: 'one',
    });
  });

  it('property() looks up descriptors', () => {
    const o = defineOntology({ objectTypes: [personOT, accountOT], actionTypes: [] });
    expect(o.property('person', 'name')?.label).toBe('Name');
    expect(o.property('person', 'nope')).toBeUndefined();
    expect(o.property('nope', 'x')).toBeUndefined();
  });

  it('actionsFor() filters by appliesTo', () => {
    const at: ActionTypeDefinition = {
      id: 'person.poke', label: 'Poke', appliesTo: 'person',
      rolesAllowed: ['rep'], marking: 'low',
      preview: () => ({ diff: {}, sideEffects: ['nudge'] }),
      apply: async () => ({ ok: true, emittedEventIds: [] }),
    };
    const o = defineOntology({ objectTypes: [personOT, accountOT], actionTypes: [at] });
    expect(o.actionsFor('person')).toHaveLength(1);
    expect(o.actionsFor('account')).toHaveLength(0);
  });

  it('rejects action type targeting an undeclared kind', () => {
    const at: ActionTypeDefinition = {
      id: 'ghost.haunt', label: 'Haunt', appliesTo: 'ghost', rolesAllowed: [], marking: 'low',
      preview: () => ({ diff: {}, sideEffects: [] }),
      apply: async () => ({ ok: true, emittedEventIds: [] }),
    };
    expect(() => defineOntology({ objectTypes: [personOT, accountOT], actionTypes: [at] }))
      .toThrow(/applies to undeclared kind/);
  });
});
