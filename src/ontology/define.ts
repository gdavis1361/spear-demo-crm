// Ontology definition — the typed schema every layer reads from.
//
// `defineOntology({...})` validates the declaration up-front (links must
// resolve to declared object types, action `appliesTo` must too), builds
// derived indexes (inverse links per object type), and returns a frozen
// `Ontology` handle. Add a new object type → declare it once → forms,
// projections, and the object explorer pick it up automatically.

import type { Marking } from './marking';
import type { PropertyDescriptor } from './property-types';

// ─── Object type ───────────────────────────────────────────────────────────

export interface ObjectTypeDefinition {
  /** Stable kind name; matches the `kind` discriminator on the existing Noun union. */
  readonly kind: string;
  /** Human label for the object type itself. */
  readonly label: string;
  /** Property name that holds the canonical primary key. */
  readonly primaryKey: string;
  /** Marking applied to the object as a whole — separate from per-property. */
  readonly marking: Marking;
  /** Property declarations, keyed by property name. */
  readonly properties: Readonly<Record<string, PropertyDescriptor>>;
  /** Outgoing link declarations, keyed by link name. */
  readonly links?: Readonly<Record<string, OutgoingLink>>;
  /** Names of action types whose `appliesTo` matches this kind. */
  readonly actions?: readonly string[];
}

export interface OutgoingLink {
  /** Target object kind. Must be a declared object type. */
  readonly to: string;
  /** Cardinality: one or many. */
  readonly cardinality: 'one' | 'many';
  /** Inverse link name on the target. Generated index makes both directions queryable. */
  readonly inverse: string;
  /** Optional marking on the relationship itself. */
  readonly marking?: Marking;
}

// ─── Action type ───────────────────────────────────────────────────────────
// Generic over its parameter shape; concrete declarations narrow `P`.

export interface ActionTypeDefinition<P = unknown, T = unknown> {
  readonly id: string;
  readonly label: string;
  /** Object kind this action applies to. */
  readonly appliesTo: string;
  /** Roles allowed to invoke. Empty array → no one. */
  readonly rolesAllowed: readonly string[];
  /** Marking — controls who can even *see* the action in the verb list. */
  readonly marking: Marking;
  /** Pure check: can this action run against this target with these params? */
  readonly preconditions?: (target: T, params: P) => true | string;
  /** Pure projection: what would happen if we applied this? */
  readonly preview: (target: T, params: P) => ActionPreview;
  /** Side-effecting commit. Result describes what was emitted. */
  readonly apply: (target: T, params: P, ctx: ActionContext) => Promise<ActionApplyResult>;
}

export interface ActionPreview {
  /** Property-level diff: { propertyName: { from, to } }. */
  readonly diff: Readonly<Record<string, { from: unknown; to: unknown }>>;
  /** Human-readable side-effect summaries. */
  readonly sideEffects: readonly string[];
}

export interface ActionContext {
  readonly clearance: Marking;
  readonly projects: readonly string[];
  readonly actorId: string;
}

export interface ActionApplyResult {
  readonly ok: boolean;
  readonly message?: string;
  /** Event log IDs emitted by this apply, in order. */
  readonly emittedEventIds: readonly string[];
}

// ─── Compiled ontology ─────────────────────────────────────────────────────

export interface Ontology {
  readonly objectTypes: ReadonlyMap<string, ObjectTypeDefinition>;
  readonly actionTypes: ReadonlyMap<string, ActionTypeDefinition>;
  /**
   * Inverse link index: given a target kind + outgoing link name on the
   * source, returns the source kind + inverse link name. Built once at
   * declaration time; used by ObjectSet to navigate backlinks.
   */
  readonly inverseLinks: ReadonlyMap<string, readonly InverseLink[]>;
  /** Property descriptor lookup: `<kind>.<property>` → descriptor. */
  property(kind: string, name: string): PropertyDescriptor | undefined;
  /** Action types whose `appliesTo` matches the given kind. */
  actionsFor(kind: string): readonly ActionTypeDefinition[];
}

export interface InverseLink {
  readonly fromKind: string;       // the source object kind
  readonly fromLinkName: string;   // the outgoing link name on the source
  readonly cardinality: 'one' | 'many';
}

// ─── defineOntology ────────────────────────────────────────────────────────

export interface OntologyInput {
  readonly objectTypes: readonly ObjectTypeDefinition[];
  readonly actionTypes: readonly ActionTypeDefinition[];
}

export function defineOntology(input: OntologyInput): Ontology {
  const objectTypes = new Map<string, ObjectTypeDefinition>();
  for (const ot of input.objectTypes) {
    if (objectTypes.has(ot.kind)) {
      throw new Error(`[ontology] duplicate object type: ${ot.kind}`);
    }
    objectTypes.set(ot.kind, ot);
  }

  // Validate links resolve to declared types.
  for (const ot of input.objectTypes) {
    for (const [name, link] of Object.entries(ot.links ?? {})) {
      if (!objectTypes.has(link.to)) {
        throw new Error(`[ontology] ${ot.kind}.${name} → ${link.to} is not a declared object type`);
      }
    }
  }

  // Validate action types' appliesTo.
  const actionTypes = new Map<string, ActionTypeDefinition>();
  for (const at of input.actionTypes) {
    if (actionTypes.has(at.id)) {
      throw new Error(`[ontology] duplicate action type: ${at.id}`);
    }
    if (!objectTypes.has(at.appliesTo)) {
      throw new Error(`[ontology] action ${at.id} applies to undeclared kind ${at.appliesTo}`);
    }
    actionTypes.set(at.id, at);
  }

  // Build inverse-link index.
  const inverseLinks = new Map<string, InverseLink[]>();
  for (const ot of input.objectTypes) {
    for (const [linkName, link] of Object.entries(ot.links ?? {})) {
      const list = inverseLinks.get(link.to) ?? [];
      list.push({ fromKind: ot.kind, fromLinkName: linkName, cardinality: link.cardinality });
      inverseLinks.set(link.to, list);
    }
  }

  return Object.freeze({
    objectTypes,
    actionTypes,
    inverseLinks,
    property(kind: string, name: string): PropertyDescriptor | undefined {
      return objectTypes.get(kind)?.properties[name];
    },
    actionsFor(kind: string): readonly ActionTypeDefinition[] {
      const out: ActionTypeDefinition[] = [];
      for (const at of actionTypes.values()) if (at.appliesTo === kind) out.push(at);
      return out;
    },
  });
}
