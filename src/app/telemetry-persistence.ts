// Telemetry durable fallback (VX10).
//
// R5 in the Linear audit: the pre-VX10 `flush()` spliced events out of
// memory before the POST, then `.catch(() => {})` on failure. Events
// that didn't land on the wire were gone. The worst case was a tab that
// died mid-session right after an incident — we lost the exact events
// that mattered most.
//
// This module is the safety net. When a flush POST fails, we persist
// the payload to an IDB ring buffer. On next boot, we re-read the
// buffer and re-submit. On success, we clear the buffer rows.
//
// Design choices:
//   - One IDB write per failed flush, NOT per `track()` call. High-
//     volume sessions never touch IDB on the happy path.
//   - Ring buffer capped at `MAX_ROWS`. Oldest rows evicted first so
//     memory pressure never grows unbounded.
//   - Rows are self-contained: each carries its own `events[]` array
//     (the payload we tried to send), so replay doesn't need to re-
//     batch across sessions.

// `openSpearDb` + the STORE_TELEMETRY constant live in `../domain/events`,
// which transitively pulls in every Zod schema in the app. Importing it
// statically lands all of that in the entry chunk (this module is
// reached via `track()` in the topbar, which renders on first paint).
// We dynamic-import instead so the durable-layer dependency only
// materializes when a batch actually needs to hit IDB — which is
// always after the first screen of work.
async function dynamicOpenDb(): Promise<{
  db: IDBDatabase;
  STORE_TELEMETRY: string;
}> {
  const { openSpearDb, STORE_TELEMETRY } = await import('../domain/events');
  const db = await openSpearDb();
  return { db, STORE_TELEMETRY };
}

export interface PersistedBatch {
  /** Monotonic id (epoch ms + tiebreaker) so insertion order survives. */
  readonly id: string;
  /** ISO timestamp for the ring-trim sweep. */
  readonly createdAt: string;
  /** Serialized JSON body the failed POST was sending. */
  readonly payload: string;
  /** How many attempts this row has seen. Just for observability. */
  readonly attemptCount: number;
}

const MAX_ROWS = 500;
/**
 * H10: hard age ceiling for persisted telemetry batches. MAX_ROWS alone
 * can let a stalled row survive for months on a low-traffic tab. Events
 * older than this are dropped by `trimRing()` even if the cap isn't
 * reached. 7 days is long enough to replay Monday's crash on Tuesday
 * morning, short enough that a stuck IDB doesn't accumulate indefinitely.
 */
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export async function persistBatch(payload: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const row: PersistedBatch = {
    id,
    createdAt: new Date().toISOString(),
    payload,
    attemptCount: 1,
  };
  try {
    const { db, STORE_TELEMETRY } = await dynamicOpenDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TELEMETRY, 'readwrite');
      tx.objectStore(STORE_TELEMETRY).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await trimRing();
  } catch {
    // Nothing to do: we failed to persist a failed send. Telemetry must
    // never break the app — silent drop is the spec.
  }
}

export async function readPersistedBatches(): Promise<readonly PersistedBatch[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const { db, STORE_TELEMETRY } = await dynamicOpenDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TELEMETRY, 'readonly');
      const req = tx.objectStore(STORE_TELEMETRY).getAll();
      req.onsuccess = () => resolve(req.result as PersistedBatch[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteBatch(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const { db, STORE_TELEMETRY } = await dynamicOpenDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TELEMETRY, 'readwrite');
      tx.objectStore(STORE_TELEMETRY).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // same swallow rule
  }
}

/** Bump attemptCount on an existing row after a retry fails (best-effort). */
export async function bumpAttempt(row: PersistedBatch): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const { db, STORE_TELEMETRY } = await dynamicOpenDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TELEMETRY, 'readwrite');
      tx.objectStore(STORE_TELEMETRY).put({ ...row, attemptCount: row.attemptCount + 1 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

async function trimRing(now: number = Date.now()): Promise<void> {
  const rows = await readPersistedBatches();
  // Two passes — age first, then count — because evicting stale rows can
  // push us back under MAX_ROWS and spare newer batches that a pure
  // count-based trim would otherwise throw away.
  const doomed = new Set<string>();
  for (const r of rows) {
    const ageMs = now - new Date(r.createdAt).getTime();
    if (ageMs > STALE_THRESHOLD_MS) doomed.add(r.id);
  }
  const survivors = rows.filter((r) => !doomed.has(r.id));
  if (survivors.length > MAX_ROWS) {
    const sorted = [...survivors].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const excess = sorted.slice(0, survivors.length - MAX_ROWS);
    for (const r of excess) doomed.add(r.id);
  }
  for (const id of doomed) await deleteBatch(id);
}

/**
 * Runs the ring-trim sweep once. Called at boot from
 * `drainPersistedTelemetry()` so a cold start with dormant rows still
 * gets the TTL applied, not just one that sees a new write.
 */
export async function sweepStaleBatches(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    await trimRing();
  } catch {
    // Telemetry must never break boot. Silent-drop keeps the invariant.
  }
}

/** Test hook: expose trimRing so callers can assert TTL with an injected now. */
export async function _trimRingForTests(now: number): Promise<void> {
  await trimRing(now);
}

/** Test hook: hard-wipe the store. */
export async function _clearForTests(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const { db, STORE_TELEMETRY } = await dynamicOpenDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TELEMETRY, 'readwrite');
    tx.objectStore(STORE_TELEMETRY).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
