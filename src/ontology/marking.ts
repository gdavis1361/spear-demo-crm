// Marking — classification levels applied to objects, properties, actions.
//
// Modeled on Palantir's `Marking` concept: every artifact carries a
// classification, every viewer carries a clearance. The projection
// layer compares them on read; under-cleared viewers see `'⊘'` (or
// the property is omitted entirely from the projection).
//
// Order matters: low < medium < high < restricted. A clearance of
// `'high'` covers `low` + `medium` + `high`.

export type Marking = 'low' | 'medium' | 'high' | 'restricted';

const RANK: Readonly<Record<Marking, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  restricted: 3,
};

/** True iff the viewer's clearance is at least as high as the marking. */
export function canRead(viewer: Marking, target: Marking): boolean {
  return RANK[viewer] >= RANK[target];
}

/**
 * The viewing context — clearance + project membership. Threaded through
 * projections so they can decide what to redact.
 */
export interface MarkingContext {
  readonly clearance: Marking;
  readonly projects: readonly string[];
}

export const ANONYMOUS: MarkingContext = { clearance: 'low', projects: [] };

export const REDACTED = '⊘' as const;
export type Redacted = typeof REDACTED;

/**
 * Apply a marking to a value. Returns the value if the viewer is cleared,
 * otherwise the redaction sentinel. Inert at runtime — no I/O.
 */
export function maybeRedact<T>(viewer: MarkingContext, marking: Marking, value: T): T | Redacted {
  return canRead(viewer.clearance, marking) ? value : REDACTED;
}

export function isRedacted(value: unknown): value is Redacted {
  return value === REDACTED;
}
