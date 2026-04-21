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
  /**
   * T2 — stream-anchored retention. When set, vacuum treats the stream
   * as a unit: it looks for an event whose `payload.kind` matches any
   * listed kind (the "completion marker"), and only vacuums the whole
   * stream when that marker's `at` + `ttlMs` has elapsed. Streams
   * without the marker are considered *active* and are never vacuumed,
   * regardless of how old their head events are.
   *
   * Why it exists: a waiting workflow run has a 48h+ gap between
   * `workflow.run_started` and its eventual `workflow.run_completed`.
   * The per-event cutoff from the default policy would have happily
   * deleted the head of a still-live run once its TTL elapsed — and
   * replay() can't reconstruct a run without `run_started`, so the
   * deleted run would look neither complete nor active, just broken.
   */
  readonly completionKinds?: readonly string[];
}

export const DEFAULT_POLICIES: readonly RetentionPolicy[] = [
  { prefix: 'schedule:', ttlMs: 7 * 24 * 60 * 60 * 1000 }, // 7 days for schedule chatter
  {
    // 30 days, completion-anchored. An in-flight run (waiting on a
    // timer, paused for replies, etc.) is NEVER vacuumed — only runs
    // that explicitly emitted `workflow.run_completed` more than 30d
    // ago are eligible.
    prefix: 'workflow:',
    ttlMs: 30 * 24 * 60 * 60 * 1000,
    completionKinds: ['workflow.run_completed'],
  },
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

  if (policy.completionKinds && policy.completionKinds.length > 0) {
    return vacuumStreamAnchored(policy, events, cutoff, deleter);
  }

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

/**
 * Stream-anchored vacuum (T2). Groups events by stream; for each
 * stream, vacuums every event iff the stream has a completion-marker
 * event AND that marker's `at` is older than `now - ttlMs`.
 *
 * Still-active streams (no completion marker) are kept in full. This is
 * the critical invariant: a waiting workflow run's head events survive
 * until the run completes — otherwise replay can't reconstruct it.
 */
async function vacuumStreamAnchored(
  policy: RetentionPolicy,
  events: readonly StoredEvent[],
  cutoff: number,
  deleter: (ids: readonly string[]) => Promise<void>
): Promise<VacuumResult> {
  const completionSet = new Set(policy.completionKinds);
  const byStream = new Map<string, StoredEvent[]>();
  for (const e of events) {
    const key = e.stream as string;
    const arr = byStream.get(key) ?? [];
    arr.push(e);
    byStream.set(key, arr);
  }

  const expired: string[] = [];
  let oldestKept: string | undefined;

  for (const streamEvents of byStream.values()) {
    const completion = streamEvents.find((e) => completionSet.has(e.payload.kind));
    // Active stream (no completion marker) — keep everything.
    if (!completion) {
      if (!oldestKept && streamEvents[0]) oldestKept = streamEvents[0].id;
      continue;
    }
    const completionTs = eventTimestamp(completion);
    if (completionTs >= cutoff) {
      // Completed, but retention window hasn't elapsed — keep.
      if (!oldestKept && streamEvents[0]) oldestKept = streamEvents[0].id;
      continue;
    }
    for (const e of streamEvents) {
      expired.push(e.id);
      if (policy.batchSize && expired.length >= policy.batchSize) break;
    }
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
  if (!at?.iso) return Number.POSITIVE_INFINITY; // refuse to delete if we can't decide
  return Date.parse(at.iso);
}

// Convenience: classify a stream key against the policy table for tests + UI.
export function ttlForStream(stream: StreamKey, policies = DEFAULT_POLICIES): number | null {
  for (const p of policies) {
    if ((stream as string).startsWith(p.prefix)) return p.ttlMs;
  }
  return null;
}
