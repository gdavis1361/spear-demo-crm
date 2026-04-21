import { describe, it, expect } from 'vitest';
import { ObjectSet } from './object-set';
import { ontology } from './spear';

const VIEWER = { clearance: 'high' as const, projects: [] };

type DealRow = { kind: 'deal'; id: string; stage: string; value: number; tags: string[] } & Record<
  string,
  unknown
>;
const ROWS: DealRow[] = [
  { kind: 'deal', id: 'd1', stage: 'inbound', value: 1_000, tags: ['PCS'] },
  { kind: 'deal', id: 'd2', stage: 'qualify', value: 5_000, tags: ['CORP'] },
  { kind: 'deal', id: 'd3', stage: 'qualify', value: 10_000, tags: ['PCS', 'INTL'] },
  { kind: 'deal', id: 'd4', stage: 'won', value: 50_000, tags: ['CORP'] },
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
    expect(set.materialize(ROWS, { ontology, viewer: VIEWER }).map((d) => d.id)).toEqual([
      'd1',
      'd4',
    ]);

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
    const original = ObjectSet.of<DealRow>('deal')
      .filter('stage', '=', 'qualify')
      .sortBy('value', 'desc');
    const url = original.toShareableURL();
    const restored = ObjectSet.fromURL<DealRow>(url);
    expect(restored).not.toBeNull();
    expect(restored!.toSpec()).toEqual(original.toSpec());
  });

  it('returns null for malformed URLs', () => {
    expect(ObjectSet.fromURL('/explore?spec=not-json')).toBeNull();
    expect(ObjectSet.fromURL('/explore')).toBeNull();
  });

  // TB9 — URL specs are untrusted input. The Zod schema refuses unknown
  // keys (`.strict()`), unknown operators, non-charset-safe paths, and
  // out-of-range limits. These tests document the exact refusal surface
  // so a future laxening is a visible diff rather than a silent regression.
  describe('fromURL adversarial inputs', () => {
    const withSpec = (spec: unknown) => `/explore?spec=${encodeURIComponent(JSON.stringify(spec))}`;

    it('rejects unknown top-level keys', () => {
      // Extra key not in the schema — `.strict()` refuses.
      expect(
        ObjectSet.fromURL(withSpec({ kind: 'deal', filters: [], extraKey: 'tampering' }))
      ).toBeNull();
    });

    it('rejects __proto__ injection via hand-crafted JSON', () => {
      // Object-literal `__proto__: x` is dropped by JSON.stringify (it's
      // the real prototype slot). To test prototype-pollution defense,
      // we craft the raw JSON string manually — this is what a malicious
      // URL would carry. `.strict()` must still refuse because
      // `__proto__` is not in the allowed key set.
      const rawJson = '{"kind":"deal","filters":[],"__proto__":{"polluted":1}}';
      const url = `/explore?spec=${encodeURIComponent(rawJson)}`;
      expect(ObjectSet.fromURL(url)).toBeNull();
    });

    it('rejects filter clauses with extra keys', () => {
      expect(
        ObjectSet.fromURL(
          withSpec({
            kind: 'deal',
            filters: [{ path: 'stage', op: '=', value: 'qualify', hijack: true }],
          })
        )
      ).toBeNull();
    });

    it('rejects unknown comparators', () => {
      expect(
        ObjectSet.fromURL(
          withSpec({ kind: 'deal', filters: [{ path: 'stage', op: 'DROP', value: 'x' }] })
        )
      ).toBeNull();
    });

    it('rejects dotted paths that contain prototype tamper tokens', () => {
      // The regex `^[A-Za-z_][A-Za-z0-9_]*(\.…)*$` refuses __proto__
      // because segments must start with a letter/underscore and then
      // contain only alphanumerics/underscores — `__proto__` starts
      // with underscore and is all allowed chars, so it DOES pass the
      // charset. That's fine: the `.strict()` check on the object
      // schema already rejects the full shape. This test locks in
      // that path-segments with dangerous characters like `[` or `$`
      // are refused.
      expect(
        ObjectSet.fromURL(
          withSpec({ kind: 'deal', filters: [{ path: 'signals[0]', op: '=', value: 'x' }] })
        )
      ).toBeNull();
      expect(
        ObjectSet.fromURL(
          withSpec({ kind: 'deal', filters: [{ path: '$where', op: '=', value: 'x' }] })
        )
      ).toBeNull();
    });

    it('rejects unreasonable limits', () => {
      expect(ObjectSet.fromURL(withSpec({ kind: 'deal', filters: [], limit: -5 }))).toBeNull();
      expect(
        ObjectSet.fromURL(withSpec({ kind: 'deal', filters: [], limit: 10_000_000 }))
      ).toBeNull();
    });

    it('rejects non-enum sort direction', () => {
      expect(
        ObjectSet.fromURL(
          withSpec({ kind: 'deal', filters: [], sort: { path: 'value', direction: 'random' } })
        )
      ).toBeNull();
    });
  });
});
