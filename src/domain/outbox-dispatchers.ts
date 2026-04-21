// Dispatcher registry — binds the outbox's typed mutation catalogue to
// concrete HTTP calls and the event log's compensating writes.
//
// Kept separate from `outbox.ts` so the outbox core stays reusable for
// future non-event-sourced mutation kinds and so tests can stub a
// registry without pulling in every api client dependency.

import type { ApiError, ErrorCode } from '../api/errors';
import { api } from '../api/client';
import type { Result } from '../api/types';
import type {
  CompensationResult,
  DispatcherRegistry,
  DispatchResult,
  OutboxMutation,
} from './outbox';
import type { EventLog } from './events';
import { signalStream } from './events';
import { runTransition } from './deal-machine';
import { repId, newIdempotencyKey } from '../lib/ids';
import type { DealId, LeadId, AccountId } from '../lib/ids';
import type { StageKey } from '../lib/types';
import { now as nowInstant } from '../lib/time';

// ─── Retry classification ──────────────────────────────────────────────────
//
// The outbox needs to know which errors are worth another spin. Transport
// + transient server errors → retry. Auth/validation/not-found → permanent.
// `idempotency_conflict` is a success-in-disguise: the server already has
// our mutation, just under an older response body we never saw — treat
// the row as done.

const NON_RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  'unauthenticated',
  'permission_denied',
  'invalid_request',
  'invalid_money',
  'invalid_id_prefix',
  'invalid_idempotency_key',
  'resource_not_found',
  'stage_transition_invalid',
  'signal_already_dismissed',
  'optimistic_lock_failure',
]);

function isRetryable(code: ErrorCode): boolean {
  return !NON_RETRYABLE.has(code);
}

// Success disguised as error: server already applied our mutation under
// this opKey. Return a synthetic success so the row is deleted.
function isCompletedDuplicate(code: ErrorCode): boolean {
  return code === 'idempotency_conflict';
}

function toDispatchResult<T>(res: Result<T>): DispatchResult {
  if (res.ok) return { ok: true, requestId: res.requestId };
  if (isCompletedDuplicate(res.error.code)) {
    return { ok: true, requestId: res.error.requestId };
  }
  return {
    ok: false,
    error: res.error,
    retryable: isRetryable(res.error.code),
    retryAfterMs: res.error.retryAfterMs,
  };
}

// ─── Registry factory ──────────────────────────────────────────────────────

/**
 * Build a dispatcher registry bound to the given event log. The log is
 * threaded in (not imported) so tests can use an in-memory log and so the
 * registry itself stays a pure function of its inputs.
 *
 * Compensations follow a strict rule: **only write durable state**. UI
 * state (local React sets, toasts) reacts to `outbox.onFailure()` events
 * from the calling component — dispatchers can't reach into React.
 */
export function buildDispatcherRegistry(log: EventLog): DispatcherRegistry {
  return {
    advance_deal: {
      async dispatch(m, opKey) {
        const res = await api.patch(
          `/deals/${m.dealId}`,
          { stage: m.toStage },
          {
            idempotencyKey: opKey,
            maxRetries: 0,
          }
        );
        return toDispatchResult(res);
      },
      // Permanent failure → revert the stage. The local event log already
      // holds the `deal.advanced` event appended at click time; writing
      // `deal.reverted` here snaps the projection back to `fromStage` and
      // any subscribed component re-renders.
      //
      // Two known-refused cases, both honestly surfaced via
      // `CompensationResult.refused` so the UI can say "didn't sync" rather
      // than the false "returned to original":
      //   1. Terminal destination (anything → won): `won` has no legal
      //      revert edge in the domain graph, so runTransition refuses
      //      with `stage_transition_invalid`.
      //   2. Optimistic lock failure: a sibling tab already moved the
      //      deal somewhere else; reverting now would overwrite that
      //      work, so the state machine refuses.
      async compensate(m, error): Promise<CompensationResult> {
        const result = await runTransition(log, {
          id: m.dealId as DealId | LeadId | AccountId,
          from: m.toStage as StageKey,
          to: m.fromStage as StageKey,
          by: repId('rep_mhall'),
          role: 'rep',
          reason: `outbox permanent failure: ${error.code}`,
        });
        if (result.ok) return { status: 'compensated' };
        console.warn(
          `[outbox:compensate] revert refused for ${m.dealId}: ${result.code} — ${result.message}`
        );
        return {
          status: 'refused',
          reason: `${result.code}: ${result.message}`,
        };
      },
    },
    dismiss_signal: {
      async dispatch(m, opKey) {
        const res = await api.post(
          `/signals/${m.signalId}/dismiss`,
          {},
          {
            idempotencyKey: opKey,
            maxRetries: 0,
          }
        );
        return toDispatchResult(res);
      },
      // Durable compensation: append `signal.dismiss_reverted` to the
      // signal's stream. SignalProjection folds it and un-dismisses the
      // row across every subscribed tab. Failure to append is rare
      // (IDB down) but real; we report refused with the reason so
      // subscribers can announce honestly.
      async compensate(m, error) {
        const result = await log.append(signalStream(m.signalId), [
          {
            opKey: `revert:${newIdempotencyKey()}`,
            payload: {
              kind: 'signal.dismiss_reverted',
              at: nowInstant(),
              by: repId('rep_mhall'),
              reason: `outbox permanent failure: ${error.code}`,
            },
          },
        ]);
        if (result.ok) return { status: 'compensated' };
        return {
          status: 'refused',
          reason: `${result.code}: ${result.message}`,
        };
      },
    },
    action_signal: {
      async dispatch(m, opKey) {
        const res = await api.post(
          `/signals/${m.signalId}/action`,
          {},
          {
            idempotencyKey: opKey,
            maxRetries: 0,
          }
        );
        return toDispatchResult(res);
      },
      // Same shape as dismiss: append the matching revert event. The UI
      // un-fades the row automatically via SignalProjection's subscription.
      async compensate(m, error) {
        const result = await log.append(signalStream(m.signalId), [
          {
            opKey: `revert:${newIdempotencyKey()}`,
            payload: {
              kind: 'signal.action_reverted',
              at: nowInstant(),
              by: repId('rep_mhall'),
              reason: `outbox permanent failure: ${error.code}`,
            },
          },
        ]);
        if (result.ok) return { status: 'compensated' };
        return {
          status: 'refused',
          reason: `${result.code}: ${result.message}`,
        };
      },
    },
  };
}

// Re-export the mutation union so call sites can import from one place.
export type { OutboxMutation };
