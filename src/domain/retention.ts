// Retention / vacuum — Postgres' `pg_cron` + partition drop, expressed
// as an idle-time tick.
//
// Some streams are write-heavy and read-rarely (`schedule:*` runs,
// completed `workflow:*` runs). Letting them grow forever burns
// IndexedDB quota for no benefit. The vacuum tick deletes events older
// than a per-prefix TTL.

import type { EventLog, StoredEvent, StreamKey } from './events';

export interface RetentionPolicy {
  /** Stream-key prefix that this policy applies to (e.g. `schedule:`). */
  readonly prefix: string;
  /** Drop events older than this many milliseconds. */
  readonly ttlMs: number;
  /**
   * Maximum events to delete in one pass. Bounded so a single tick
   * can't stall the UI or hit IDB transaction timeouts.
   */
  readonly batchSize?: number;
}

export const DEFAULT_POLICIES: readonly RetentionPolicy[] = [
  { prefix: 'schedule:', ttlMs: 7 * 24 * 60 * 60 * 1000 },     // 7 days for schedule chatter
  { prefix: 'workflow:', ttlMs: 30 * 24 * 60 * 60 * 1000 },    // 30 days for workflow runs
];

export interface VacuumResult {
  readonly prefix: string;
  readonly scanned: number;
  readonly deleted: number;
  readonly oldestKept?: string;
}

/**
 * Run vacuum for one policy. Pure with respect to "now": passing a fixed
 * `now` makes the result deterministic for tests.
 */
export async function vacuumOnce(
  log: EventLog,
  policy: RetentionPolicy,
  now: number = Date.now(),
  // Internal: a delete callback. The IDB backend will provide one that
  // actually removes rows; the in-memory backend overrides for tests.
  deleter: (ids: readonly string[]) => Promise<void> = async () => undefined
): Promise<VacuumResult> {
  const events = await log.readPrefix(policy.prefix);
  const cutoff = now - policy.ttlMs;
  const expired: string[] = [];
  let oldestKept: string | undefined;
  for (const e of events) {
    const ts = eventTimestamp(e);
    if (ts < cutoff) expired.push(e.id);
    else if (!oldestKept) oldestKept = e.id;
    if (policy.batchSize && expired.length >= policy.batchSize) break;
  }
  if (expired.length > 0) await deleter(expired);
  return { prefix: policy.prefix, scanned: events.length, deleted: expired.length, oldestKept };
}

/** Run every configured policy. Returns one result per policy. */
export async function vacuumAll(
  log: EventLog,
  policies: readonly RetentionPolicy[] = DEFAULT_POLICIES,
  now: number = Date.now(),
  deleter: (ids: readonly string[]) => Promise<void> = async () => undefined
): Promise<readonly VacuumResult[]> {
  const out: VacuumResult[] = [];
  for (const p of policies) out.push(await vacuumOnce(log, p, now, deleter));
  return out;
}

/**
 * Extract the event-time timestamp (ms since epoch) from a stored event.
 * Every payload kind carries an `at: Instant`; we use that — not the row's
 * insertion time — because business retention is about when something
 * happened, not when it landed in storage.
 */
function eventTimestamp(e: StoredEvent): number {
  const at = (e.payload as { at?: { iso?: string } }).at;
  if (!at?.iso) return Number.POSITIVE_INFINITY;  // refuse to delete if we can't decide
  return Date.parse(at.iso);
}

// Convenience: classify a stream key against the policy table for tests + UI.
export function ttlForStream(stream: StreamKey, policies = DEFAULT_POLICIES): number | null {
  for (const p of policies) {
    if ((stream as string).startsWith(p.prefix)) return p.ttlMs;
  }
  return null;
}
