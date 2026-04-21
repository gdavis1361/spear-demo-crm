// Snapshot — `pg_dump` for the durable layer.
//
// Export produces a portable JSON file covering BOTH the event log AND the
// row-level promise store. Import is the inverse: every event runs through
// full Zod validation; every promise row likewise. Bad rows land in a
// structured report rather than corrupting the live state.
//
// This is the user's escape hatch. "Clear site data" no longer means
// "lose the truth" — they can save the snapshot, clear, re-import.

import type { EventLog } from './events';
import { openSpearDb, STORE_PROMISES } from './events';
import { validateEnvelope, validateDurablePromise } from './event-schema';

export interface Snapshot {
  readonly schemaVersion: number;
  readonly takenAt: string;
  readonly count: number;             // events + promise rows
  readonly events: readonly unknown[]; // raw envelopes, validated on import
  readonly promises: readonly unknown[]; // raw rows, validated on import
}

/**
 * Snapshot schema version. Bump on backwards-incompatible shape changes.
 * v3 added `promises[]` alongside `events[]`. Older v2 snapshots without
 * a promises field still validate via the back-compat path in
 * `validateSnapshot`.
 */
export const SNAPSHOT_SCHEMA_VERSION = 3;

/**
 * Read every stream prefix and emit one document. The output is sorted
 * by ULID so importing into a fresh log produces an identical event
 * sequence; promises are sorted by id for stable diffs.
 */
export async function exportSnapshot(log: EventLog): Promise<Snapshot> {
  const prefixes = ['deal:', 'account:', 'promise:', 'schedule:', 'workflow:'];
  const events: unknown[] = [];
  for (const p of prefixes) {
    const rows = await log.readPrefix(p);
    for (const r of rows) events.push(r);
  }
  events.sort((a, b) => {
    const ai = (a as { id?: string }).id ?? '';
    const bi = (b as { id?: string }).id ?? '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  const promises = await readAllPromiseRows();
  promises.sort((a, b) => {
    const ai = (a as { id?: string }).id ?? '';
    const bi = (b as { id?: string }).id ?? '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    takenAt: new Date().toISOString(),
    count: events.length + promises.length,
    events,
    promises,
  };
}

async function readAllPromiseRows(): Promise<unknown[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROMISES, 'readonly');
    const req = tx.objectStore(STORE_PROMISES).getAll();
    req.onsuccess = () => resolve(req.result as unknown[]);
    req.onerror = () => reject(req.error);
  });
}

export interface ImportReport {
  readonly events:   { accepted: number; rejected: number; issues: readonly { idx: number; reason: string }[] };
  readonly promises: { accepted: number; rejected: number; issues: readonly { idx: number; reason: string }[] };
}

/**
 * Validate snapshot shape. Accepts current (v3) and one-version-back (v2)
 * documents — older snapshots without a `promises` field migrate forward
 * by treating that field as empty.
 */
export function validateSnapshot(snap: unknown): { ok: true; data: Snapshot } | { ok: false; reason: string } {
  if (!snap || typeof snap !== 'object') return { ok: false, reason: 'snapshot must be an object' };
  const s = snap as Partial<Snapshot> & { schemaVersion?: number };
  if (s.schemaVersion !== SNAPSHOT_SCHEMA_VERSION && s.schemaVersion !== 2) {
    return { ok: false, reason: `unsupported schemaVersion ${s.schemaVersion} (current ${SNAPSHOT_SCHEMA_VERSION})` };
  }
  if (!Array.isArray(s.events)) return { ok: false, reason: 'events must be an array' };
  const promises = Array.isArray(s.promises) ? s.promises : [];
  return {
    ok: true,
    data: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      takenAt: s.takenAt ?? '',
      count: (s.events?.length ?? 0) + promises.length,
      events: s.events ?? [],
      promises,
    },
  };
}

export function previewImport(snap: Snapshot): ImportReport {
  let acc_e = 0;
  const ie: { idx: number; reason: string }[] = [];
  for (let i = 0; i < snap.events.length; i++) {
    const v = validateEnvelope(snap.events[i]);
    if (v.ok) acc_e++;
    else ie.push({ idx: i, reason: v.error.issues[0]?.message ?? 'invalid' });
  }
  let acc_p = 0;
  const ip: { idx: number; reason: string }[] = [];
  for (let i = 0; i < snap.promises.length; i++) {
    const v = validateDurablePromise(snap.promises[i]);
    if (v.ok) acc_p++;
    else ip.push({ idx: i, reason: v.error.issues[0]?.message ?? 'invalid' });
  }
  return {
    events:   { accepted: acc_e, rejected: snap.events.length - acc_e,   issues: ie },
    promises: { accepted: acc_p, rejected: snap.promises.length - acc_p, issues: ip },
  };
}
