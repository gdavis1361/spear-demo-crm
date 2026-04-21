// Storage stats — `pg_stat_user_tables` for the durable layer.
//
// Operators (and tests, and a future debug page) need to know:
//   - how many rows per stream prefix
//   - DLQ size for events + promises
//   - total bytes (best-effort via storage estimate)
//   - last vacuum time + total deleted
//
// All reads are non-blocking and tolerate per-store failures so a single
// IDB hiccup doesn't take down the whole stats panel.

import {
  openSpearDb,
  STORE_PROMISES,
  STORE_PROMISES_DLQ,
  type EventLog,
} from './events';

const STORE_EVENTS = 'events';
const STORE_EVENTS_DLQ = 'events_dlq';

const STREAM_PREFIXES = ['deal:', 'account:', 'promise:', 'schedule:', 'workflow:'] as const;
type StreamPrefix = typeof STREAM_PREFIXES[number];

export interface StorageStats {
  readonly events: {
    readonly total: number;
    readonly byPrefix: Readonly<Record<StreamPrefix, number>>;
    readonly dlq: number;
  };
  readonly promises: {
    readonly total: number;
    readonly byStatus: Readonly<Record<'pending' | 'kept' | 'missed' | 'escalated', number>>;
    readonly dlq: number;
  };
  /** Estimated bytes used by the entire `spear-events` database. */
  readonly estimatedBytes: number | null;
  readonly lastVacuum: { at: string; totalDeleted: number } | null;
}

/**
 * Best-effort row count for an object store. Returns 0 if the store is
 * absent or the read fails (e.g. node environment without IDB).
 */
async function countStore(name: string): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  try {
    const db = await openSpearDb();
    if (!db.objectStoreNames.contains(name)) return 0;
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(name, 'readonly');
      const req = tx.objectStore(name).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

async function readPromiseStatuses(): Promise<Record<'pending' | 'kept' | 'missed' | 'escalated', number>> {
  const acc = { pending: 0, kept: 0, missed: 0, escalated: 0 } as Record<'pending' | 'kept' | 'missed' | 'escalated', number>;
  if (typeof indexedDB === 'undefined') return acc;
  try {
    const db = await openSpearDb();
    if (!db.objectStoreNames.contains(STORE_PROMISES)) return acc;
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROMISES, 'readonly');
      const req = tx.objectStore(STORE_PROMISES).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    for (const r of rows) {
      const s = (r as { status?: string }).status;
      if (s === 'pending' || s === 'kept' || s === 'missed' || s === 'escalated') acc[s]++;
    }
  } catch {
    // best-effort
  }
  return acc;
}

async function eventsByPrefix(log: EventLog): Promise<Record<StreamPrefix, number>> {
  const acc = Object.fromEntries(STREAM_PREFIXES.map((p) => [p, 0])) as Record<StreamPrefix, number>;
  for (const p of STREAM_PREFIXES) {
    try {
      acc[p] = (await log.readPrefix(p)).length;
    } catch {
      acc[p] = 0;
    }
  }
  return acc;
}

async function estimateBytes(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    return typeof e.usage === 'number' ? e.usage : null;
  } catch {
    return null;
  }
}

// Singleton holder for "last vacuum" — updated by callers (vacuum-runner).
let lastVacuum: { at: string; totalDeleted: number } | null = null;

export function recordVacuumOutcome(at: string, totalDeleted: number): void {
  lastVacuum = { at, totalDeleted };
}

export async function getStorageStats(log: EventLog): Promise<StorageStats> {
  const [byPrefix, eventsTotal, eventsDlq, promisesTotal, promisesDlq, byStatus, estimatedBytes] = await Promise.all([
    eventsByPrefix(log),
    countStore(STORE_EVENTS),
    countStore(STORE_EVENTS_DLQ),
    countStore(STORE_PROMISES),
    countStore(STORE_PROMISES_DLQ),
    readPromiseStatuses(),
    estimateBytes(),
  ]);

  return {
    events:   { total: eventsTotal,   byPrefix, dlq: eventsDlq },
    promises: { total: promisesTotal, byStatus, dlq: promisesDlq },
    estimatedBytes,
    lastVacuum,
  };
}
