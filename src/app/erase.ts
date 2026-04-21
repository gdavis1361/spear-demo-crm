// TB3 — eraseAllLocalState: the single "forget me" primitive.
//
// Local-first apps carry PII on the user's device (message bodies,
// quote text, promise notes). GDPR Article 17 + CCPA §1798.105
// require an erasure affordance on request. "Open DevTools → IndexedDB
// → delete" is not a compliant answer.
//
// This function is the durable implementation; a UI affordance (see
// DevPalette) calls it behind a confirmation prompt, then navigates
// home to force a fresh boot.
//
// Ordering matters:
//   1. Tear down the stores that hold IDB connections (promiseStore,
//      dealProjection, signalProjection, outbox). Their dispose()
//      methods close BroadcastChannels + stop timers, but the IDB
//      connection lives at the singleton layer in events.ts.
//   2. Close the cached IDB connection — `indexedDB.deleteDatabase`
//      blocks forever on any live connection.
//   3. Delete every database we own (the current DB + every seed DB
//      we can enumerate). Each deletion is fire-and-forget; a blocked
//      deletion just means the user left another tab open, in which
//      case the ReloadToHome step below makes the next boot clean.
//   4. Clear sessionStorage + localStorage keys under the `spear:*`
//      namespace. We never put PII here, but scenario state, reset
//      markers, and feature-flag overrides accumulate; wiping them is
//      the complete "forget me" story.
//   5. Caller decides whether to reload. We don't `location.reload()`
//      here so tests can assert outcomes without window navigation.

import { closeDbConnection, getDbName } from '../domain/events';
import { promiseStore, dealProjection, signalProjection, outbox } from './runtime';

export interface EraseOptions {
  /**
   * Also enumerate + delete every seed scenario DB
   * (`spear-events-seed-*`). Default true — we're "forgetting me,"
   * not "forgetting this one DB." A false flag is exposed only for
   * tests that want to assert the current DB was touched without
   * having to clean up a forest of scenario databases.
   */
  readonly clearAllSeedDbs?: boolean;
}

export interface EraseReport {
  readonly dbDeleted: string;
  readonly seedDbsDeleted: readonly string[];
  readonly storageKeysCleared: readonly string[];
}

export async function eraseAllLocalState(opts: EraseOptions = {}): Promise<EraseReport> {
  const clearSeeds = opts.clearAllSeedDbs ?? true;

  // 1. Dispose in-memory stores that hold channel/timer handles.
  try {
    promiseStore.dispose();
  } catch {
    /* fall through — partial tear-down is still useful */
  }
  try {
    dealProjection.dispose();
  } catch {
    /* noop */
  }
  try {
    signalProjection.dispose();
  } catch {
    /* noop */
  }
  try {
    outbox.dispose();
  } catch {
    /* noop */
  }

  // 2. Close the shared IDB connection so `deleteDatabase` can proceed.
  await closeDbConnection();

  // 3. Delete databases.
  const currentDb = getDbName();
  const dbDeleted = await deleteDbBestEffort(currentDb);

  const seedDbsDeleted: string[] = [];
  if (clearSeeds && typeof indexedDB !== 'undefined' && 'databases' in indexedDB) {
    // `indexedDB.databases()` enumerates every DB the origin can see.
    // Not yet in every browser (Firefox lacks it through 2024); absent
    // → just skip the sweep. The user can still clear per-seed via
    // the scenario reset path.
    try {
      const list = await indexedDB.databases();
      for (const entry of list) {
        if (!entry.name) continue;
        if (!entry.name.startsWith('spear-events-seed-')) continue;
        const deleted = await deleteDbBestEffort(entry.name);
        if (deleted === entry.name) seedDbsDeleted.push(entry.name);
      }
    } catch {
      // Best effort — permissions, quota, etc. aren't fatal here.
    }
  }

  // 4. Storage keys under the `spear:*` namespace.
  const storageKeysCleared = clearSpearNamespaceStorage();

  return { dbDeleted, seedDbsDeleted, storageKeysCleared };
}

async function deleteDbBestEffort(name: string): Promise<string> {
  if (typeof indexedDB === 'undefined') return '';
  return new Promise<string>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    const done = (outName: string): void => resolve(outName);
    req.onsuccess = () => done(name);
    req.onerror = () => done('');
    // onblocked fires when another tab holds a connection. We still
    // resolve to empty-string so the caller can report accurately
    // rather than hanging.
    req.onblocked = () => done('');
  });
}

function clearSpearNamespaceStorage(): readonly string[] {
  const cleared: string[] = [];
  const clearFrom = (storage: Storage | undefined): void => {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k !== null && k.startsWith('spear:')) keys.push(k);
    }
    for (const k of keys) {
      storage.removeItem(k);
      cleared.push(k);
    }
  };
  if (typeof sessionStorage !== 'undefined') clearFrom(sessionStorage);
  if (typeof localStorage !== 'undefined') clearFrom(localStorage);
  return cleared;
}
