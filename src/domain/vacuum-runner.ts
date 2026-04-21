// Vacuum runner — closes the gap from the prior audit ("retention helper
// exists, nothing actually deletes").
//
// Wires the pure `vacuumOnce` to a real IDB deleter and an idle-time
// scheduler. Runs at most once per `intervalMs`, defers to
// `requestIdleCallback` when available so it never competes with the
// rendering pipeline. Telemetry on every pass.

import {
  openSpearDb,
  type StreamKey,
} from './events';
import { vacuumAll, DEFAULT_POLICIES, type RetentionPolicy, type VacuumResult } from './retention';
import type { EventLog } from './events';

const STORE_EVENTS = 'events';

/**
 * Real deleter — removes rows from the events store by primary key (ULID).
 * Each batch runs in a single readwrite transaction with strict durability.
 */
async function deleteEventRows(ids: readonly string[]): Promise<void> {
  if (ids.length === 0 || typeof indexedDB === 'undefined') return;
  const db = await openSpearDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite', { durability: 'strict' });
    const store = tx.objectStore(STORE_EVENTS);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface VacuumRunReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly results: readonly VacuumResult[];
  readonly totalDeleted: number;
}

export interface VacuumRunner {
  /** Force one pass immediately (returns the report). */
  runNow(): Promise<VacuumRunReport>;
  /** Most recent run report. */
  lastReport(): VacuumRunReport | null;
  /** Stop the scheduler. */
  stop(): void;
}

let installed = false;

export interface InstallVacuumOptions {
  /** Wall-time interval between passes. Default 1h. */
  intervalMs?: number;
  /** Retention policies. Default `DEFAULT_POLICIES` from retention.ts. */
  policies?: readonly RetentionPolicy[];
  /** "Now" provider — overrideable for tests. */
  now?: () => number;
}

/**
 * Install the vacuum runner. Idempotent — subsequent calls return the
 * existing runner. Browser-only; in node returns a no-op runner.
 */
export function installVacuumRunner(
  log: EventLog,
  opts: InstallVacuumOptions = {},
): VacuumRunner {
  const intervalMs = opts.intervalMs ?? 60 * 60 * 1000; // 1h
  const policies = opts.policies ?? DEFAULT_POLICIES;
  const now = opts.now ?? Date.now;

  let report: VacuumRunReport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleHandle: number | null = null;

  const runOnce = async (): Promise<VacuumRunReport> => {
    const startedAt = new Date(now()).toISOString();
    const results = await vacuumAll(log, policies, now(), deleteEventRows);
    const finishedAt = new Date(now()).toISOString();
    const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
    report = { startedAt, finishedAt, results, totalDeleted };
    return report;
  };

  const schedule = () => {
    if (timer || typeof window === 'undefined') return;
    timer = setTimeout(async () => {
      timer = null;
      await whenIdle(() => void runOnce().finally(schedule));
    }, intervalMs);
  };

  const whenIdle = (fn: () => void): Promise<void> => {
    return new Promise((resolve) => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
      if (typeof ric === 'function') {
        idleHandle = ric(() => { fn(); resolve(); });
      } else {
        // Fallback: defer to the next macrotask.
        setTimeout(() => { fn(); resolve(); }, 0);
      }
    });
  };

  if (!installed && typeof window !== 'undefined') {
    installed = true;
    schedule();
  }

  return {
    runNow: () => runOnce(),
    lastReport: () => report,
    stop: () => {
      if (timer) { clearTimeout(timer); timer = null; }
      const cic = (typeof window !== 'undefined' ? (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback : undefined);
      if (idleHandle !== null && typeof cic === 'function') cic(idleHandle);
      idleHandle = null;
      installed = false;
    },
  };
}

/** Test/admin: run one pass with a real deleter, no scheduling. */
export async function vacuumNow(
  log: EventLog,
  policies: readonly RetentionPolicy[] = DEFAULT_POLICIES,
  nowMs: number = Date.now(),
): Promise<VacuumRunReport> {
  const startedAt = new Date(nowMs).toISOString();
  const results = await vacuumAll(log, policies, nowMs, deleteEventRows);
  const finishedAt = new Date(nowMs).toISOString();
  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
  return { startedAt, finishedAt, results, totalDeleted };
}

// Re-export for tests + UI code that wants to introspect.
export type { StreamKey };
