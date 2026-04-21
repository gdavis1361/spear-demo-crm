// Deal state machine — transitions are a finite graph, not a free string.
//
// Every state transition is committed via `appendIf`, an optimistic-lock
// IDB transaction: read the stream, project current stage, refuse if it
// no longer matches `from`. This closes the TOCTOU window between two
// concurrent writers (different tabs, retries, the API roundtrip).

import type { StageKey, Role } from '../lib/types';
import type { DealId, LeadId, AccountId, RepId } from '../lib/ids';
import type { EventLog, StoredEvent } from './events';
import { dealStream, withStreamLock } from './events';
import type { Instant } from '../lib/time';
import { now as nowInstant } from '../lib/time';
import { newIdempotencyKey } from '../lib/ids';
import type { ErrorCode } from '../api/errors';

/**
 * Graph of allowed stage transitions. Edges only — no self-loops.
 * `lost` is terminal; `won` permits a one-step revert to `verbal` so a
 * signed deal can be un-signed when the contract falls through
 * (customer backs out, legal blocks, etc). Realistic CRM behavior —
 * and it lets the outbox compensator revert a server-refused
 * `verbal → won` without silently lying about local state (VX6).
 */
export const TRANSITIONS: Readonly<Record<StageKey, readonly StageKey[]>> = {
  inbound: ['qualify'],
  qualify: ['scoping', 'inbound'], // revert-one-step is allowed
  scoping: ['quote', 'qualify'],
  quote: ['verbal', 'scoping'],
  verbal: ['won', 'quote'], // re-quote path
  won: ['verbal'], // un-sign when a contract falls through
} as const;

export function canTransition(from: StageKey, to: StageKey): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Direction of the transition (forward vs revert), used to emit the right event. */
export function transitionKind(from: StageKey, to: StageKey): 'advanced' | 'reverted' {
  const forward = ['inbound', 'qualify', 'scoping', 'quote', 'verbal', 'won'];
  return forward.indexOf(to) > forward.indexOf(from) ? 'advanced' : 'reverted';
}

export interface TransitionOk {
  ok: true;
  id: string;
  seq: number;
}
export interface TransitionErr {
  ok: false;
  code: ErrorCode;
  message: string;
}
export type TransitionResult = TransitionOk | TransitionErr;

export interface DealTransition {
  id: DealId | LeadId | AccountId;
  from: StageKey;
  to: StageKey;
  by: RepId;
  role: Role;
  reason?: string;
  /** Idempotency key. Same value on retry → at most one event written. */
  opKey?: string;
}

/**
 * Run a transition under an optimistic lock. The pipeline is:
 *
 *   navigator.locks.request('spear:deal:<id>') {
 *     IDB transaction {
 *       read stream → currentStage(events)
 *       refuse if currentStage !== t.from        // optimistic_lock_failure
 *       refuse if !canTransition(from, to)       // stage_transition_invalid
 *       refuse if opKey already used             // idempotent: return prior event
 *       append deal.advanced | deal.reverted
 *     }
 *   }
 *
 * Same-key retries are safe; concurrent writers from another tab lose to
 * the lock and either succeed against the new state or fall through to
 * `optimistic_lock_failure`.
 */
export async function runTransition(
  log: EventLog,
  t: DealTransition,
  at: Instant = nowInstant()
): Promise<TransitionResult> {
  if (t.from === t.to) {
    return {
      ok: false,
      code: 'stage_transition_invalid',
      message: `No-op transition from ${t.from}`,
    };
  }
  if (!canTransition(t.from, t.to)) {
    return {
      ok: false,
      code: 'stage_transition_invalid',
      message: `Illegal transition ${t.from} → ${t.to}`,
    };
  }

  const opKey = t.opKey ?? newIdempotencyKey();
  const kind = transitionKind(t.from, t.to);
  const stream = dealStream(t.id);

  return withStreamLock(stream, async () => {
    const result = await log.appendIf(
      stream,
      [
        {
          opKey,
          payload:
            kind === 'advanced'
              ? { kind: 'deal.advanced', at, by: t.by, from: t.from, to: t.to, reason: t.reason }
              : {
                  kind: 'deal.reverted',
                  at,
                  by: t.by,
                  from: t.from,
                  to: t.to,
                  reason: t.reason ?? 'n/a',
                },
        },
      ],
      (existing) => projectedStageMatches(existing, t.from)
    );

    if (!result.ok) {
      const code: ErrorCode =
        result.code === 'optimistic_lock_failure'
          ? 'optimistic_lock_failure'
          : result.code === 'invalid_payload'
            ? 'invalid_request'
            : 'internal_error';
      return { ok: false, code, message: result.message };
    }
    const e = result.events[0];
    return { ok: true, id: e.id, seq: e.seq };
  });
}

function projectedStageMatches(existing: readonly StoredEvent[], expected: StageKey): boolean {
  // Deals seeded outside the event log are assumed to be at `expected` —
  // any other stored history must end at `expected` too.
  if (existing.length === 0) return true;
  let stage: StageKey | null = null;
  for (const e of existing) {
    const p = e.payload;
    if (p.kind === 'deal.created') stage = p.stage;
    else if (p.kind === 'deal.advanced' || p.kind === 'deal.reverted') stage = p.to;
    else if (p.kind === 'deal.signed') stage = 'won';
  }
  return stage === expected;
}

/**
 * Fold a deal's event stream to its current stage. The fold is pure —
 * same input, same output. This is the determinism contract that the
 * replay test asserts.
 */
export function currentStage(events: readonly StoredEvent[]): StageKey | null {
  let stage: StageKey | null = null;
  for (const e of events) {
    const p = e.payload;
    if (p.kind === 'deal.created') stage = p.stage;
    else if (p.kind === 'deal.advanced' || p.kind === 'deal.reverted') stage = p.to;
    else if (p.kind === 'deal.signed') stage = 'won';
    else if (p.kind === 'deal.lost') stage = null; // terminal; lost isn't in StageKey union
  }
  return stage;
}
