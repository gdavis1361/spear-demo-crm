// Event payload types — TypeScript shapes that mirror `event-schema.ts`.
//
// Why both? Zod owns runtime validation; these types own compile-time
// inference for callers. They're kept in sync by hand AND by an automated
// test (`event-schema.test.ts`) that asserts every TS kind has a Zod
// schema and vice versa.

import type { Instant } from '../lib/time';
import type { StageKey } from '../lib/types';
import type { Money } from '../lib/money';
import type { RepId, PersonId, SignalId, DocId } from '../lib/ids';
import type { StreamKey } from './events';

export type DealEvent =
  | {
      kind: 'deal.created';
      at: Instant;
      by: RepId;
      stage: StageKey;
      value: Money;
      displayId: string;
      title: string;
      meta: string;
      branch: string;
      tags: string[];
      hot?: boolean;
      warm?: boolean;
    }
  | { kind: 'deal.advanced'; at: Instant; by: RepId; from: StageKey; to: StageKey; reason?: string }
  | { kind: 'deal.reverted'; at: Instant; by: RepId; from: StageKey; to: StageKey; reason: string }
  | { kind: 'deal.quote_sent'; at: Instant; by: RepId; quoteText: string }
  | { kind: 'deal.quote_expired'; at: Instant }
  | { kind: 'deal.signed'; at: Instant; by: RepId; contractId: string }
  | { kind: 'deal.lost'; at: Instant; by: RepId; reason: string };

export type AccountEvent =
  | { kind: 'account.message_received'; at: Instant; from: PersonId; body: string }
  | { kind: 'account.message_sent'; at: Instant; by: RepId; body: string }
  | { kind: 'account.file_uploaded'; at: Instant; by: RepId; docId: DocId; size: number }
  | { kind: 'account.signal_fired'; at: Instant; signalId: SignalId }
  | { kind: 'account.meeting_held'; at: Instant; attendees: PersonId[]; durationMin: number }
  | { kind: 'account.claim_resolved'; at: Instant; claimId: string; resolvedInMs: number };

export type PromiseEvent =
  | {
      kind: 'promise.created';
      at: Instant;
      by: RepId;
      text: string;
      dueAt: Instant;
      escalateAt?: Instant;
    }
  | { kind: 'promise.kept'; at: Instant; by: RepId }
  | { kind: 'promise.missed'; at: Instant }
  | { kind: 'promise.escalated'; at: Instant; toMgr: RepId };

export type ScheduleEvent =
  | { kind: 'schedule.run_started'; at: Instant; scheduledFor: Instant }
  | { kind: 'schedule.run_completed'; at: Instant; runId: string; items: number }
  | { kind: 'schedule.run_failed'; at: Instant; runId: string; code: string; message: string }
  | { kind: 'schedule.dead_lettered'; at: Instant; runId: string; attempts: number };

// Signal events — mirror `event-schema.ts`. `signal.dismiss_reverted` +
// `signal.action_reverted` exist solely so the outbox compensator has a
// durable, projection-visible way to undo an optimistic mark when the
// server permanently refuses. Same pattern as deal.reverted.
export type SignalEvent =
  | { kind: 'signal.dismissed'; at: Instant; by: RepId; reason?: string }
  | { kind: 'signal.dismiss_reverted'; at: Instant; by: RepId; reason: string }
  | { kind: 'signal.actioned'; at: Instant; by: RepId }
  | { kind: 'signal.action_reverted'; at: Instant; by: RepId; reason: string };

export type WorkflowRunEvent =
  | { kind: 'workflow.run_started'; at: Instant; version: number; trigger: string }
  | {
      kind: 'workflow.step_executed';
      at: Instant;
      stepIdx: number;
      stepKind: string;
      outcome: 'ok' | 'skip';
      ms: number;
    }
  | {
      kind: 'workflow.step_failed';
      at: Instant;
      stepIdx: number;
      stepKind: string;
      code: string;
      message: string;
    }
  | { kind: 'workflow.run_completed'; at: Instant; disposition: string }
  | { kind: 'workflow.run_compensated'; at: Instant; compensated: number; reason: string }
  // T1: wait step lifecycle. `wait_armed` records the fireAt + resumeOn
  // contract the runner is honoring; `wait_resumed` is written by the
  // armed-wait ticker (or, eventually, a signal-arrival path) when the
  // wait ends, so replay can reconstruct the transition.
  | {
      kind: 'workflow.wait_armed';
      at: Instant;
      stepIdx: number;
      fireAt: Instant;
      // Not readonly: the Zod schema infers `string[]` and the event log
      // types must match the validated shape exactly or the event-log
      // append/read round-trip fails to narrow.
      resumeOn: string[];
    }
  | {
      kind: 'workflow.wait_resumed';
      at: Instant;
      stepIdx: number;
      cause: 'timer' | 'signal';
    };

// Legacy union — the in-storage envelope no longer carries `stream` on the
// payload (it lives on the envelope), but some call sites still want this
// shape. Keep until callers migrate.
export type DomainEvent =
  | (DealEvent & { stream: StreamKey })
  | (AccountEvent & { stream: StreamKey })
  | (PromiseEvent & { stream: StreamKey })
  | (ScheduleEvent & { stream: StreamKey })
  | (WorkflowRunEvent & { stream: StreamKey })
  | (SignalEvent & { stream: StreamKey });

export type EventName = (
  | DealEvent
  | AccountEvent
  | PromiseEvent
  | ScheduleEvent
  | WorkflowRunEvent
  | SignalEvent
)['kind'];
