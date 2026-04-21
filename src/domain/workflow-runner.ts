// Workflow runner — interpreter for `WorkflowDefinition`.
//
// Three modes:
//   - `validate(def)`      — static checks (steps non-empty, ends on `end`)
//   - `dryRun(def, ctx)`   — produce the expected event trace without side effects
//   - `run(def, ctx, log)` — execute, emit events, return final state
//   - `replay(def, events)` — recover state from a frozen event log
//
// `run(def, ctx, ...)` and `replay(def, trace)` must produce identical
// state for identical inputs. That's the determinism contract, asserted
// in `workflow-runner.test.ts`.

import type { Instant } from '../lib/time';
import { now as nowInstant } from '../lib/time';
import type { EventLog, StoredEvent, WorkflowRunEvent } from './events';
import { workflowRunStream } from './events';
import type { WorkflowDefinition, WorkflowStep, Disposition, ActionVerb } from './workflow-def';
import { track } from '../app/telemetry';
import { startSpan } from '../app/observability';

/**
 * Per-verb activity implementation. Throwing (sync or async) is how an
 * activity signals failure; `run()` catches the throw, emits
 * `workflow.step_failed`, and marks the run terminal with disposition
 * `'failed'`. A return value is ignored — the event log is the durable
 * record of success, not the activity's return.
 *
 * C2 will register concrete activities from `runtime.ts`; in C1 the map
 * is empty in production and the only exercise is via test injection.
 */
export type ActivityFn = (
  step: Extract<WorkflowStep, { kind: 'action' }>,
  ctx: RunContext
) => Promise<void>;

export type ActivityRegistry = Partial<Record<ActionVerb, ActivityFn>>;

export interface RunContext {
  /** Input data piped in from the trigger. Opaque — predicates read from it. */
  readonly input: Readonly<Record<string, unknown>>;
  /** Stable run identifier. */
  readonly runId: string;
  /** Optional override of "now" for deterministic tests. */
  readonly now?: () => Instant;
  /**
   * Verb → activity dispatcher. Absent in the current demo path; supplied
   * by `bootRuntime` once activities are wired (C2). Action steps whose
   * verb is not registered here execute as no-ops (current behavior).
   */
  readonly activities?: ActivityRegistry;
}

export interface RunStepTrace {
  readonly idx: number;
  readonly kind: WorkflowStep['kind'];
  readonly outcome: 'ok' | 'skip' | 'wait' | 'failed';
  readonly label: string;
  readonly ms: number;
  readonly error?: string;
}

export interface RunResult {
  readonly runId: string;
  readonly workflowId: string;
  readonly version: number;
  readonly disposition: Disposition | 'waiting';
  readonly steps: readonly RunStepTrace[];
  readonly totalMs: number;
  readonly events: readonly WorkflowRunEvent[];
}

// ─── Validation ────────────────────────────────────────────────────────────

export interface ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export function validate(def: WorkflowDefinition): ValidationResult {
  const issues: string[] = [];
  if (def.steps.length === 0) issues.push('workflow has no steps');
  if (def.steps[0]?.kind !== 'trigger') issues.push('first step must be a `trigger`');
  const last = def.steps[def.steps.length - 1];
  if (last?.kind !== 'end') issues.push('last step must be an `end`');
  if (def.version < 1) issues.push('version must be ≥ 1');
  return { ok: issues.length === 0, issues };
}

// ─── Versioning ────────────────────────────────────────────────────────────

/**
 * Branch on the version recorded in the run. Mirrors Temporal's
 * `workflow.patched(id)`. In-flight runs whose version predates the
 * patch take the old path; new runs take the new path.
 */
export function patched(runVersion: number, introducedAt: number): boolean {
  return runVersion >= introducedAt;
}

// ─── Core executor ─────────────────────────────────────────────────────────
// Executes deterministically. `shouldPass` is pure. `wait` steps short-
// circuit with a `waiting` disposition — a real runner would persist the
// resume signal and pick up later.

function shouldPass(step: WorkflowStep, ctx: RunContext): boolean {
  if (step.kind !== 'filter') return true;
  const val = ctx.input[step.predicate];
  return String(val) === step.expected;
}

function executeStep(step: WorkflowStep, ctx: RunContext): 'ok' | 'skip' | 'wait' {
  switch (step.kind) {
    case 'trigger':
      return 'ok';
    case 'filter':
      return shouldPass(step, ctx) ? 'ok' : 'skip';
    case 'action':
      return 'ok';
    case 'wait':
      return 'wait';
    case 'end':
      return 'ok';
  }
}

function finalDisposition(def: WorkflowDefinition): Disposition {
  const last = def.steps[def.steps.length - 1];
  if (last?.kind === 'end') return last.disposition;
  return 'dropped';
}

// ─── dry-run ───────────────────────────────────────────────────────────────

export function dryRun(def: WorkflowDefinition, ctx: RunContext): RunResult {
  const nowFn = ctx.now ?? nowInstant;
  const startedAt = nowFn();
  const events: WorkflowRunEvent[] = [
    {
      kind: 'workflow.run_started',
      at: startedAt,
      version: def.version,
      trigger: (def.steps[0] as { source?: string }).source ?? 'manual',
    },
  ];
  const steps: RunStepTrace[] = [];
  let disposition: RunResult['disposition'] = 'dropped';

  let waitingAtStep: number | null = null;
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const outcome = executeStep(step, ctx);
    const at = nowFn();
    if (outcome === 'wait') {
      // Record the wait as an executed step with outcome 'skip' (placeholder
      // for "paused"). A `workflow.run_completed` is intentionally NOT emitted
      // — replay treats absence of run_completed as `waiting`. This keeps the
      // event log honest.
      events.push({
        kind: 'workflow.step_executed',
        at,
        stepIdx: i,
        stepKind: step.kind,
        outcome: 'skip',
        ms: 0,
      });
      steps.push({ idx: i, kind: step.kind, outcome: 'wait', label: step.label, ms: 0 });
      waitingAtStep = i;
      break;
    }
    events.push({
      kind: 'workflow.step_executed',
      at,
      stepIdx: i,
      stepKind: step.kind,
      outcome: outcome === 'ok' ? 'ok' : 'skip',
      ms: 0,
    });
    steps.push({ idx: i, kind: step.kind, outcome, label: step.label, ms: 0 });
    if (outcome === 'skip') {
      disposition = 'dropped';
      break;
    }
    if (step.kind === 'end') {
      disposition = step.disposition;
    }
  }

  if (waitingAtStep === null) {
    events.push({ kind: 'workflow.run_completed', at: nowFn(), disposition });
  }

  return {
    runId: ctx.runId,
    workflowId: def.id,
    version: def.version,
    disposition: waitingAtStep !== null ? 'waiting' : disposition,
    steps,
    totalMs: 0,
    events,
  };
}

// ─── run with event emission ──────────────────────────────────────────────
//
// Unlike `dryRun`, `run()` owns its own step loop. Previously it wrapped
// `dryRun` + persisted the trace; that was fine as long as nothing could
// fail, but T4 requires the runner to catch activity throws and emit
// `workflow.step_failed`. A step that throws diverges from the dryRun
// prediction, so the two can no longer share a trace — `dryRun` stays
// honest about "what would happen if every activity succeeded", `run()`
// tells the truth about what actually happened.

export async function run(
  def: WorkflowDefinition,
  ctx: RunContext,
  log: EventLog
): Promise<RunResult> {
  // H6: emit `workflow.started` / `workflow.completed` telemetry
  // alongside the durable event-log writes. Event-log is the system of
  // record; telemetry gives the SRE team a honeycomb-queryable stream
  // without having to replay event logs. H5 wraps the span around both.
  track({ name: 'workflow.started', props: { workflowId: def.id, runId: ctx.runId } });
  const t0 =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const result = (await startSpan(
    {
      name: `workflow.run.${def.id}`,
      op: 'workflow.run',
      attributes: {
        'workflow.id': def.id,
        'workflow.version': def.version,
        'workflow.run_id': ctx.runId,
      },
    },
    async () => {
      const r = await executeRun(def, ctx);
      const stream = workflowRunStream(def.id, ctx.runId);
      // opKey is deterministic per (runId, eventIdx) — re-running this
      // function with the same runId is an idempotent storage operation.
      await log.append(
        stream,
        r.events.map((payload, idx) => ({ opKey: `${ctx.runId}:${idx}`, payload }))
      );
      return r;
    }
  )) as RunResult;
  const t1 =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  // Any step that failed pushes its trace with `outcome: 'failed'`; the
  // run as a whole counts as failed for the SLI when that happens, even
  // if `disposition` is a routing state like 'dropped' or 'queued'.
  // 'waiting' is not a terminal outcome — we still emit a completion
  // event because the run returned, but mark it ok so the SLI doesn't
  // punish a paused workflow.
  const anyFailed = result.steps.some((s) => s.outcome === 'failed');
  const status: 'ok' | 'failed' = anyFailed ? 'failed' : 'ok';
  track({
    name: 'workflow.completed',
    props: {
      workflowId: def.id,
      runId: ctx.runId,
      ms: Math.round(t1 - t0),
      steps: result.steps.length,
      status,
    },
  });
  return result;
}

// Core executor — shared trace-building logic with async activity dispatch
// + throw-to-step_failed mapping. Kept internal so `run()` stays the only
// public entry point that writes to the log.
async function executeRun(def: WorkflowDefinition, ctx: RunContext): Promise<RunResult> {
  const nowFn = ctx.now ?? nowInstant;
  const events: WorkflowRunEvent[] = [
    {
      kind: 'workflow.run_started',
      at: nowFn(),
      version: def.version,
      trigger: (def.steps[0] as { source?: string }).source ?? 'manual',
    },
  ];
  const steps: RunStepTrace[] = [];
  let disposition: RunResult['disposition'] = 'dropped';
  let waitingAtStep: number | null = null;
  let failed = false;

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];

    // Activity dispatch: only `action` steps whose verb is registered run
    // a real function. Unregistered verbs fall through to a no-op — same
    // as the prior runner — so a partially-wired activity table doesn't
    // break untested workflows.
    if (step.kind === 'action') {
      const activity = ctx.activities?.[step.verb];
      if (activity) {
        try {
          await activity(step, ctx);
        } catch (cause) {
          const at = nowFn();
          const code =
            (typeof cause === 'object' && cause && 'code' in cause
              ? String((cause as { code: unknown }).code)
              : undefined) ?? 'activity_threw';
          const message = cause instanceof Error ? cause.message : 'activity failed';
          events.push({
            kind: 'workflow.step_failed',
            at,
            stepIdx: i,
            stepKind: step.kind,
            code,
            message,
          });
          steps.push({
            idx: i,
            kind: step.kind,
            outcome: 'failed',
            label: step.label,
            ms: 0,
            error: message,
          });
          failed = true;
          break;
        }
      }
    }

    const outcome = executeStep(step, ctx);
    const at = nowFn();
    if (outcome === 'wait') {
      events.push({
        kind: 'workflow.step_executed',
        at,
        stepIdx: i,
        stepKind: step.kind,
        outcome: 'skip',
        ms: 0,
      });
      steps.push({ idx: i, kind: step.kind, outcome: 'wait', label: step.label, ms: 0 });
      waitingAtStep = i;
      break;
    }
    events.push({
      kind: 'workflow.step_executed',
      at,
      stepIdx: i,
      stepKind: step.kind,
      outcome: outcome === 'ok' ? 'ok' : 'skip',
      ms: 0,
    });
    steps.push({ idx: i, kind: step.kind, outcome, label: step.label, ms: 0 });
    if (outcome === 'skip') {
      disposition = 'dropped';
      break;
    }
    if (step.kind === 'end') {
      disposition = step.disposition;
    }
  }

  if (failed) {
    disposition = 'failed';
    events.push({ kind: 'workflow.run_completed', at: nowFn(), disposition: 'failed' });
  } else if (waitingAtStep === null) {
    events.push({ kind: 'workflow.run_completed', at: nowFn(), disposition });
  }

  return {
    runId: ctx.runId,
    workflowId: def.id,
    version: def.version,
    disposition: waitingAtStep !== null ? 'waiting' : disposition,
    steps,
    totalMs: 0,
    events,
  };
}

// ─── replay ────────────────────────────────────────────────────────────────
// Given a frozen event stream, reconstruct the run result. Must be
// byte-identical to the result of `run()` on the same inputs.

export function replay(def: WorkflowDefinition, events: readonly StoredEvent[]): RunResult | null {
  // Pull just the workflow-shaped payloads. The runtime tag on `kind` is
  // enough to narrow safely back to `WorkflowRunEvent`.
  const runEvents: WorkflowRunEvent[] = [];
  for (const e of events) {
    const p = e.payload;
    if (p.kind.startsWith('workflow.')) runEvents.push(p as unknown as WorkflowRunEvent);
  }
  if (runEvents.length === 0) return null;

  const started = runEvents.find((e) => e.kind === 'workflow.run_started');
  const completed = runEvents.find((e) => e.kind === 'workflow.run_completed');
  if (!started || started.kind !== 'workflow.run_started') return null;

  const steps: RunStepTrace[] = [];
  for (const e of runEvents) {
    if (e.kind === 'workflow.step_executed') {
      const defStep = def.steps[e.stepIdx];
      const label = defStep?.label ?? '(unknown)';
      // A `wait` step records as `step_executed` with outcome 'skip'; reconstruct
      // its trace outcome by checking the def. This keeps the event log honest:
      // we don't fabricate a 'wait' outcome that wasn't on the wire.
      const isWait = defStep?.kind === 'wait';
      steps.push({
        idx: e.stepIdx,
        kind: e.stepKind as WorkflowStep['kind'],
        outcome: isWait ? 'wait' : e.outcome === 'ok' ? 'ok' : 'skip',
        label,
        ms: e.ms,
      });
    } else if (e.kind === 'workflow.step_failed') {
      const defStep = def.steps[e.stepIdx];
      const label = defStep?.label ?? '(unknown)';
      steps.push({
        idx: e.stepIdx,
        kind: e.stepKind as WorkflowStep['kind'],
        outcome: 'failed',
        label,
        ms: 0,
        error: e.message,
      });
    }
  }

  // Parse runId from the stream key: "workflow:<wfId>:run:<runId>"
  const streamParts = (events[0]?.stream as string | undefined)?.split(':') ?? [];
  const runId = streamParts[3] ?? 'unknown';

  // The absence of `workflow.run_completed` plus a tail `wait` step → still waiting.
  const tailIsWait = steps[steps.length - 1]?.outcome === 'wait';
  const disposition: RunResult['disposition'] =
    completed && completed.kind === 'workflow.run_completed'
      ? (completed.disposition as Disposition)
      : tailIsWait
        ? 'waiting'
        : finalDisposition(def);

  return {
    runId,
    workflowId: def.id,
    version: started.version,
    disposition,
    steps,
    totalMs: 0,
    events: runEvents,
  };
}
