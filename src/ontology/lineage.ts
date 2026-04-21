// Lineage — every derived value traces back to the inputs that produced it.
//
// Operators trust scores they can audit. The TodayCard.score becomes
// `{ value, lineage: { model, version, refreshedAt, contributors[] } }`
// and the Peek panel renders the contributors on demand.

import type { Instant } from '../lib/time';

export interface LineageContributor {
  /** Stable identifier for what fed into this score: a signal id, a feature name, etc. */
  readonly source: string;
  /** Human label for the explainer panel. */
  readonly label: string;
  /** Weight in the final value, in [0, 1]. */
  readonly weight: number;
  /** Optional pointer to the originating object: `${kind}:${id}`. */
  readonly objectRef?: string;
}

export interface Lineage {
  /** Producing model identifier, e.g. `spear-priority-v3`. */
  readonly model: string;
  /** Model version — bumps when scoring logic changes. */
  readonly version: number;
  /** When the value was computed. */
  readonly refreshedAt: Instant;
  /** Ordered contributors. Sum of weights must be ≤ 1.0 (validated). */
  readonly contributors: readonly LineageContributor[];
}

export interface DerivedValue<T> {
  readonly value: T;
  readonly lineage: Lineage;
}

const EPS = 1e-9;

export function makeDerived<T>(value: T, lineage: Lineage): DerivedValue<T> {
  // Per-weight check first: an out-of-range weight is the more specific error.
  for (const c of lineage.contributors) {
    if (c.weight < 0 || c.weight > 1) {
      throw new Error(`[lineage] contributor "${c.source}" weight ${c.weight} out of [0,1]`);
    }
  }
  const sum = lineage.contributors.reduce((s, c) => s + c.weight, 0);
  if (sum > 1 + EPS) {
    throw new Error(`[lineage] contributor weights sum to ${sum.toFixed(3)} > 1.0`);
  }
  return { value, lineage };
}

export function isDerivedValue<T>(v: unknown): v is DerivedValue<T> {
  return !!v && typeof v === 'object' && 'value' in v && 'lineage' in v;
}

/** Top contributors by weight, for the UI explainer. */
export function topContributors(d: DerivedValue<unknown>, n = 3): readonly LineageContributor[] {
  return [...d.lineage.contributors].sort((a, b) => b.weight - a.weight).slice(0, n);
}
