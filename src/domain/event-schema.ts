// Event schemas — Zod parsers per event kind, used at every storage
// boundary (append + read). Storage refuses malformed payloads on write
// and quarantines malformed rows on read into a dead-letter store.
//
// This is the Postgres CHECK / NOT NULL / FK story expressed in TypeScript.

import { z } from 'zod';
import { isUlid } from '../lib/ulid';

// ─── Primitives ────────────────────────────────────────────────────────────

const Instant = z.object({ iso: z.string().datetime() });

const Money = z.object({
  amountMinor: z.bigint(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD']),
});

// Branded ID prefixes — mirror the runtime contract in `lib/ids.ts`.
const idWith = (prefix: string) =>
  z.string().refine((s) => s.startsWith(`${prefix}_`), {
    message: `expected id with prefix "${prefix}_"`,
  });

const RepId = idWith('rep');
const PersonId = idWith('per');
const SignalId = idWith('sig').or(z.string().regex(/^SIG-\d+$/, 'legacy SIG-NNNN id'));
const DocId = idWith('doc').or(z.string().regex(/^MV-\d+$/, 'legacy MV-NNNN id'));

// Stage enum — mirrors `StageKey`.
const Stage = z.enum(['inbound', 'qualify', 'scoping', 'quote', 'verbal', 'won']);

// ─── Per-event schemas ─────────────────────────────────────────────────────

const DealCreated = z.object({
  kind: z.literal('deal.created'),
  at: Instant,
  by: RepId,
  stage: Stage,
  value: Money,
  // Display fields: carried on the event so a projection can rebuild the
  // Deal (title, display-id, branch, tags) from the stream alone. Before
  // these were added, Deals lived as a static array and the stream only
  // owned transitions — now the stream owns the whole entity.
  displayId: z.string().min(1),
  title: z.string().min(1),
  meta: z.string(),
  branch: z.string().min(1),
  tags: z.array(z.string()),
  hot: z.boolean().optional(),
  warm: z.boolean().optional(),
});

// Legal advance edges — duplicated here as a CHECK-constraint analogue.
// Updates here MUST mirror `TRANSITIONS` in deal-machine.ts; a test
// asserts they stay in sync.
const ADVANCE_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['inbound', 'qualify'],
  ['qualify', 'scoping'],
  ['scoping', 'quote'],
  ['quote', 'verbal'],
  ['verbal', 'won'],
] as const;
const REVERT_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['qualify', 'inbound'],
  ['scoping', 'qualify'],
  ['quote', 'scoping'],
  ['verbal', 'quote'],
  ['won', 'verbal'], // VX6: un-sign a deal (contract falls through)
] as const;

const DealAdvanced = z
  .object({
    kind: z.literal('deal.advanced'),
    at: Instant,
    by: RepId,
    from: Stage,
    to: Stage,
    reason: z.string().optional(),
  })
  .refine((e) => ADVANCE_EDGES.some(([f, t]) => f === e.from && t === e.to), {
    message: 'illegal advance edge',
  });

const DealReverted = z
  .object({
    kind: z.literal('deal.reverted'),
    at: Instant,
    by: RepId,
    from: Stage,
    to: Stage,
    reason: z.string(),
  })
  .refine((e) => REVERT_EDGES.some(([f, t]) => f === e.from && t === e.to), {
    message: 'illegal revert edge',
  });

const DealQuoteSent = z.object({
  kind: z.literal('deal.quote_sent'),
  at: Instant,
  by: RepId,
  quoteText: z.string().min(1),
});
const DealQuoteExpired = z.object({ kind: z.literal('deal.quote_expired'), at: Instant });
const DealSigned = z.object({
  kind: z.literal('deal.signed'),
  at: Instant,
  by: RepId,
  contractId: z.string().min(1),
});
const DealLost = z.object({
  kind: z.literal('deal.lost'),
  at: Instant,
  by: RepId,
  reason: z.string().min(1),
});

const AccountMessageReceived = z.object({
  kind: z.literal('account.message_received'),
  at: Instant,
  from: PersonId,
  body: z.string(),
});
const AccountMessageSent = z.object({
  kind: z.literal('account.message_sent'),
  at: Instant,
  by: RepId,
  body: z.string(),
});
const AccountFileUploaded = z.object({
  kind: z.literal('account.file_uploaded'),
  at: Instant,
  by: RepId,
  docId: DocId,
  size: z.number().int().nonnegative(),
});
const AccountSignalFired = z.object({
  kind: z.literal('account.signal_fired'),
  at: Instant,
  signalId: SignalId,
});
const AccountMeetingHeld = z.object({
  kind: z.literal('account.meeting_held'),
  at: Instant,
  attendees: z.array(PersonId).min(1),
  durationMin: z.number().int().positive(),
});
const AccountClaimResolved = z.object({
  kind: z.literal('account.claim_resolved'),
  at: Instant,
  claimId: z.string(),
  resolvedInMs: z.number().int().nonnegative(),
});

// Signal events. Dismiss + action are user-driven marks layered on top of
// the static signal fixture; reverts exist so the outbox compensator can
// undo them on permanent server failure (mirrors deal.advanced /
// deal.reverted). `by` is optional because cross-tab replays preserve the
// original author implicitly — the data is on the preceding event.
const SignalDismissed = z.object({
  kind: z.literal('signal.dismissed'),
  at: Instant,
  by: RepId,
  reason: z.string().optional(),
});
const SignalDismissReverted = z.object({
  kind: z.literal('signal.dismiss_reverted'),
  at: Instant,
  by: RepId,
  reason: z.string(),
});
const SignalActioned = z.object({
  kind: z.literal('signal.actioned'),
  at: Instant,
  by: RepId,
});
const SignalActionReverted = z.object({
  kind: z.literal('signal.action_reverted'),
  at: Instant,
  by: RepId,
  reason: z.string(),
});

const PromiseCreated = z.object({
  kind: z.literal('promise.created'),
  at: Instant,
  by: RepId,
  text: z.string().min(1),
  dueAt: Instant,
  escalateAt: Instant.optional(),
});
const PromiseKept = z.object({ kind: z.literal('promise.kept'), at: Instant, by: RepId });
const PromiseMissed = z.object({ kind: z.literal('promise.missed'), at: Instant });
const PromiseEscalated = z.object({
  kind: z.literal('promise.escalated'),
  at: Instant,
  toMgr: RepId,
});

const ScheduleRunStarted = z.object({
  kind: z.literal('schedule.run_started'),
  at: Instant,
  scheduledFor: Instant,
});
const ScheduleRunCompleted = z.object({
  kind: z.literal('schedule.run_completed'),
  at: Instant,
  runId: z.string(),
  items: z.number().int().nonnegative(),
});
const ScheduleRunFailed = z.object({
  kind: z.literal('schedule.run_failed'),
  at: Instant,
  runId: z.string(),
  code: z.string(),
  message: z.string(),
});
const ScheduleDeadLetter = z.object({
  kind: z.literal('schedule.dead_lettered'),
  at: Instant,
  runId: z.string(),
  attempts: z.number().int().positive(),
});

const WorkflowRunStarted = z.object({
  kind: z.literal('workflow.run_started'),
  at: Instant,
  version: z.number().int().positive(),
  trigger: z.string(),
});
const WorkflowStepExecuted = z.object({
  kind: z.literal('workflow.step_executed'),
  at: Instant,
  stepIdx: z.number().int().nonnegative(),
  stepKind: z.string(),
  outcome: z.enum(['ok', 'skip']),
  ms: z.number().int().nonnegative(),
});
const WorkflowStepFailed = z.object({
  kind: z.literal('workflow.step_failed'),
  at: Instant,
  stepIdx: z.number().int().nonnegative(),
  stepKind: z.string(),
  code: z.string(),
  message: z.string(),
});
const WorkflowRunCompleted = z.object({
  kind: z.literal('workflow.run_completed'),
  at: Instant,
  disposition: z.string(),
});
// T1: a wait step "arms" with a durable record of when it should fire +
// what signals may resume it early. The matching `wait_resumed` event is
// written by the ticker (or a signal-arrival path, future) when the wait
// ends. Absence of `wait_resumed` on a stream whose tail is `wait_armed`
// is what `replay()` uses to call the run `waiting`.
const WorkflowWaitArmed = z.object({
  kind: z.literal('workflow.wait_armed'),
  at: Instant,
  stepIdx: z.number().int().nonnegative(),
  fireAt: Instant,
  resumeOn: z.array(z.string()),
});
const WorkflowWaitResumed = z.object({
  kind: z.literal('workflow.wait_resumed'),
  at: Instant,
  stepIdx: z.number().int().nonnegative(),
  cause: z.enum(['timer', 'signal']),
});
const WorkflowRunCompensated = z.object({
  kind: z.literal('workflow.run_compensated'),
  at: Instant,
  compensated: z.number().int().nonnegative(),
  reason: z.string(),
});

// ─── Stream tag + envelope ─────────────────────────────────────────────────

const Stream = z
  .string()
  .regex(/^(deal|account|promise|schedule|workflow|signal):/, 'invalid stream prefix');

// Discriminated union over `kind`. Zod picks the right schema by literal.
// Each event then gets the `stream` tag added by the unioned wrapper below.
const Payload = z.discriminatedUnion('kind', [
  DealCreated,
  DealAdvanced,
  DealReverted,
  DealQuoteSent,
  DealQuoteExpired,
  DealSigned,
  DealLost,
  AccountMessageReceived,
  AccountMessageSent,
  AccountFileUploaded,
  AccountSignalFired,
  AccountMeetingHeld,
  AccountClaimResolved,
  PromiseCreated,
  PromiseKept,
  PromiseMissed,
  PromiseEscalated,
  ScheduleRunStarted,
  ScheduleRunCompleted,
  ScheduleRunFailed,
  ScheduleDeadLetter,
  WorkflowRunStarted,
  WorkflowStepExecuted,
  WorkflowStepFailed,
  WorkflowRunCompleted,
  WorkflowRunCompensated,
  WorkflowWaitArmed,
  WorkflowWaitResumed,
  SignalDismissed,
  SignalDismissReverted,
  SignalActioned,
  SignalActionReverted,
]);

export const EventEnvelope = z.object({
  /** ULID — the canonical primary key. K-sortable, distribution-safe. */
  id: z.string().refine(isUlid, 'must be a 26-char ULID'),
  /** Caller-provided idempotency key. UNIQUE (stream, opKey) at the storage layer. */
  opKey: z.string().min(1),
  /** Per-stream monotonic counter — derived on read for display. */
  seq: z.number().int().positive(),
  /** Stream tag (`deal:ld_…`, `account:acc_…`, `promise:pr_…`, …). */
  stream: Stream,
  payload: Payload,
});

export type EventEnvelopeT = z.infer<typeof EventEnvelope>;
export type ValidatedPayload = z.infer<typeof Payload>;

export function validatePayload(
  p: unknown
): { ok: true; data: ValidatedPayload } | { ok: false; error: z.ZodError } {
  const r = Payload.safeParse(p);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

export function validateEnvelope(
  e: unknown
): { ok: true; data: EventEnvelopeT } | { ok: false; error: z.ZodError } {
  const r = EventEnvelope.safeParse(e);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

// Re-export for tests / external callers that want to assert against the literal edges.
export { ADVANCE_EDGES, REVERT_EDGES };

// ─── BroadcastChannel envelope ─────────────────────────────────────────────
// Tabs from older builds (or a malicious extension) can post to our
// `BroadcastChannel`. Validate every inbound message before touching state.

export const PromiseBroadcastSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cleared') }),
  z.object({ kind: z.literal('delete'), id: z.string().min(1) }),
  z.object({ kind: z.literal('upsert'), id: z.string().min(1), row: z.unknown() }),
]);

export type PromiseBroadcastT = z.infer<typeof PromiseBroadcastSchema>;

// ─── DurablePromise row schema ─────────────────────────────────────────────
// Validated on every read from the IDB `promises` store. Bad rows go to
// the same dead-letter pattern the event log uses.

const PromiseStatus = z.enum(['pending', 'kept', 'missed', 'escalated']);

// `updatedAt` is required on the type but Zod transforms a missing value
// into `createdAt` for back-compat with v3-era rows that never wrote it.
export const DurablePromiseSchema = z
  .object({
    id: z.string().min(1),
    noun: z.object({
      kind: z.string().min(1),
      id: z.string().min(1),
    }),
    text: z.string().min(1),
    dueAt: Instant,
    escalateAt: Instant.optional(),
    createdBy: RepId,
    createdAt: Instant,
    /** Bumped on every put. Mirrors Postgres `updated_at` trigger discipline. */
    updatedAt: Instant.optional(),
    status: PromiseStatus,
  })
  .transform((p) => ({ ...p, updatedAt: p.updatedAt ?? p.createdAt }));

export type DurablePromiseT = z.infer<typeof DurablePromiseSchema>;

export function validateDurablePromise(
  raw: unknown
): { ok: true; data: DurablePromiseT } | { ok: false; error: z.ZodError } {
  const r = DurablePromiseSchema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error };
}
