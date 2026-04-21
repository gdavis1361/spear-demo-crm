// Read audit — every Peek, every set materialization emits an event so a
// future SIEM can answer "who looked at SSgt. Alvarez's deal yesterday?"
//
// Two new event kinds, separate from the write-audit event log:
//   - `object.viewed`  — single object Peeked
//   - `set.queried`    — an ObjectSet was materialized
//
// Both go through a tiny ring buffer with a Beacon-on-flush sender so
// the read traffic doesn't dominate the write log. (In a real Foundry
// deployment these stream to a separate audit pipeline.)

import type { Instant } from '../lib/time';
import { now as nowInstant } from '../lib/time';

export interface ObjectViewedEvent {
  readonly kind: 'object.viewed';
  readonly at: Instant;
  readonly actorId: string;
  readonly objectKind: string;
  readonly objectId: string;
  readonly surface: string;     // 'peek' | 'today' | 'pipeline' | 'palette' | …
}

export interface SetQueriedEvent {
  readonly kind: 'set.queried';
  readonly at: Instant;
  readonly actorId: string;
  readonly objectKind: string;
  readonly filterCount: number;
  readonly resultCount: number;
}

export type ReadAuditEvent = ObjectViewedEvent | SetQueriedEvent;

// ─── Ring buffer ───────────────────────────────────────────────────────────

const CAPACITY = 1000;
const buffer: ReadAuditEvent[] = [];
const subs = new Set<(events: readonly ReadAuditEvent[]) => void>();

export function recordObjectViewed(args: Omit<ObjectViewedEvent, 'kind' | 'at'> & { at?: Instant }): void {
  push({ kind: 'object.viewed', at: args.at ?? nowInstant(), ...args });
}

export function recordSetQueried(args: Omit<SetQueriedEvent, 'kind' | 'at'> & { at?: Instant }): void {
  push({ kind: 'set.queried', at: args.at ?? nowInstant(), ...args });
}

function push(e: ReadAuditEvent): void {
  if (buffer.length >= CAPACITY) buffer.shift();
  buffer.push(e);
  for (const s of subs) s(buffer);
}

export function recentAudit(n = 100): readonly ReadAuditEvent[] {
  return buffer.slice(-n);
}

export function subscribeAudit(fn: (events: readonly ReadAuditEvent[]) => void): () => void {
  subs.add(fn);
  fn(buffer);
  return () => { subs.delete(fn); };
}

/** Test-only — clears the buffer between assertions. */
export function _resetAuditForTests(): void {
  buffer.length = 0;
  subs.clear();
}
