import { describe, it, expect } from 'vitest';
import { ObjectSet } from './object-set';
import { ontology } from './spear';

const VIEWER = { clearance: 'high' as const, projects: [] };

type DealRow = { kind: 'deal'; id: string; stage: string; value: number; tags: string[] } & Record<string, unknown>;
const ROWS: DealRow[] = [
  { kind: 'deal', id: 'd1', stage: 'inbound', value: 1_000, tags: ['PCS'] },
  { kind: 'deal', id: 'd2', stage: 'qualify', value: 5_000, tags: ['CORP'] },
  { kind: 'deal', id: 'd3', stage: 'qualify', value: 10_000, tags: ['PCS', 'INTL'] },
  { kind: 'deal', id: 'd4', stage: 'won',     value: 50_000, tags: ['CORP'] },
];

describe('ObjectSet builder', () => {
  it('filter applies an equality predicate', () => {
    const set = ObjectSet.of<DealRow>('deal').filter('stage', '=', 'qualify');
    const out = set.materialize(ROWS, { ontology, viewer: VIEWER });
    expect(out.map((d) => d.id)).toEqual(['d2', 'd3']);
  });

  it('chained filters AND together', () => {
    const set = ObjectSet.of<DealRow>('deal')
      .filter('stage', '=', 'qualify')
      .filter('value', '>', 5_000);
    const out = set.materialize(ROWS, { ontology, viewer: VIEWER });
    expect(out.map((d) => d.id)).toEqual(['d3']);
  });

  it('supports `in` and `not_in`', () => {
    const set = ObjectSet.of<DealRow>('deal').filter('stage', 'in', ['inbound', 'won']);
    expect(set.materialize(ROWS, { ontology, viewer: VIEWER }).map((d) => d.id)).toEqual(['d1', 'd4']);

    const set2 = ObjectSet.of<DealRow>('deal').filter('stage', 'not_in', ['won']);
    expect(set2.materialize(ROWS, { ontology, viewer: VIEWER })).toHaveLength(3);
  });

  it('sortBy + limit', () => {
    const set = ObjectSet.of<DealRow>('deal').sortBy('value', 'desc').limit(2);
    const out = set.materialize(ROWS, { ontology, viewer: VIEWER });
    expect(out.map((d) => d.id)).toEqual(['d4', 'd3']);
  });

  it('drops all rows when viewer is below the object marking', () => {
    const set = ObjectSet.of<DealRow>('deal');
    const out = set.materialize(ROWS, { ontology, viewer: { clearance: 'low', projects: [] } });
    expect(out).toHaveLength(0); // Deal is marked `medium`
  });

  it('round-trips through URL serialization', () => {
    const original = ObjectSet.of<DealRow>('deal').filter('stage', '=', 'qualify').sortBy('value', 'desc');
    const url = original.toShareableURL();
    const restored = ObjectSet.fromURL<DealRow>(url);
    expect(restored).not.toBeNull();
    expect(restored!.toSpec()).toEqual(original.toSpec());
  });

  it('returns null for malformed URLs', () => {
    expect(ObjectSet.fromURL('/explore?spec=not-json')).toBeNull();
    expect(ObjectSet.fromURL('/explore')).toBeNull();
  });
});
