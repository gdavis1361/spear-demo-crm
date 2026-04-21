// ObjectSet — composable, typed query builder over the ontology.
//
// The single primitive that makes Spear an ontology-driven app: every
// screen is a saved set rendered in a different shape. Filter chains
// stay declarative + serializable so two reps can share a URL and see
// the same set of deals.
//
// Implementation is in-memory + per-set; a real backend would push the
// predicate down to PostgreSQL or Foundry's query engine.

import type { Ontology } from './define';
import type { MarkingContext } from './marking';
import { canRead } from './marking';

export type Comparator =
  | '='   | '!='
  | '>'   | '>='
  | '<'   | '<='
  | 'in'  | 'not_in'
  | 'starts_with' | 'contains';

export interface FilterClause {
  readonly path: string;            // dotted path: `account.pod`, `signals[].priority`
  readonly op: Comparator;
  readonly value: unknown;
}

export interface ObjectSetSpec {
  readonly kind: string;
  readonly filters: readonly FilterClause[];
  readonly sort?: { readonly path: string; readonly direction: 'asc' | 'desc' };
  readonly limit?: number;
}

// ─── Predicate engine ──────────────────────────────────────────────────────

function valueAt(obj: Readonly<Record<string, unknown>>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function applyOp(actual: unknown, op: Comparator, expected: unknown): boolean {
  switch (op) {
    case '=':           return actual === expected;
    case '!=':          return actual !== expected;
    case '>':           return (actual as number) >  (expected as number);
    case '>=':          return (actual as number) >= (expected as number);
    case '<':           return (actual as number) <  (expected as number);
    case '<=':          return (actual as number) <= (expected as number);
    case 'in':          return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':      return Array.isArray(expected) && !expected.includes(actual);
    case 'starts_with': return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'contains':    return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
  }
}

// ─── Builder ───────────────────────────────────────────────────────────────

export class ObjectSet<T extends { [k: string]: unknown }> {
  private readonly spec: ObjectSetSpec;

  private constructor(spec: ObjectSetSpec) {
    this.spec = spec;
  }

  static of<T extends { [k: string]: unknown }>(kind: string): ObjectSet<T> {
    return new ObjectSet<T>({ kind, filters: [] });
  }

  filter(path: string, op: Comparator, value: unknown): ObjectSet<T> {
    return new ObjectSet<T>({ ...this.spec, filters: [...this.spec.filters, { path, op, value }] });
  }

  sortBy(path: string, direction: 'asc' | 'desc' = 'asc'): ObjectSet<T> {
    return new ObjectSet<T>({ ...this.spec, sort: { path, direction } });
  }

  limit(n: number): ObjectSet<T> {
    return new ObjectSet<T>({ ...this.spec, limit: n });
  }

  toSpec(): ObjectSetSpec {
    return this.spec;
  }

  /**
   * Materialize the set against a candidate row source. Marking context
   * decides which rows survive the access check (rows whose object-level
   * marking exceeds the viewer's clearance are dropped).
   */
  materialize(rows: readonly T[], opts: { ontology: Ontology; viewer: MarkingContext }): readonly T[] {
    const ot = opts.ontology.objectTypes.get(this.spec.kind);
    if (!ot) throw new Error(`[object-set] unknown kind: ${this.spec.kind}`);
    if (!canRead(opts.viewer.clearance, ot.marking)) return [];

    let out = rows.filter((row) =>
      this.spec.filters.every((f) => applyOp(valueAt(row, f.path), f.op, f.value))
    );

    if (this.spec.sort) {
      const { path, direction } = this.spec.sort;
      out = [...out].sort((a, b) => {
        const va = valueAt(a, path);
        const vb = valueAt(b, path);
        if (va === vb) return 0;
        const cmp = (va as number | string) < (vb as number | string) ? -1 : 1;
        return direction === 'asc' ? cmp : -cmp;
      });
    }
    if (this.spec.limit != null) out = out.slice(0, this.spec.limit);
    return out;
  }

  // ─── URL serialization ───────────────────────────────────────────────────

  toShareableURL(base = '/explore'): string {
    return `${base}?spec=${encodeURIComponent(JSON.stringify(this.spec))}`;
  }

  static fromURL<T extends { [k: string]: unknown }>(href: string): ObjectSet<T> | null {
    try {
      const url = new URL(href, 'http://localhost');
      const raw = url.searchParams.get('spec');
      if (!raw) return null;
      const spec = JSON.parse(decodeURIComponent(raw)) as ObjectSetSpec;
      if (!spec.kind || !Array.isArray(spec.filters)) return null;
      return new ObjectSet<T>(spec);
    } catch {
      return null;
    }
  }
}
