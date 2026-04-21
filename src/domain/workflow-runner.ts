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
 * Per-activity invocation context. The runner hands this to every
 * activity so side-effectful activities (an email send, an outbox
 * enqueue) can tag their own storage with a stable, per-step key. Same
 * `(workflowId, runId, stepIdx)` produces the same `opKey` on every
 * attempt — retries are guaranteed idempotent at the activity boundary,
 * the same way deal transitions are idempotent at the event-log
 * boundary (`deal-machine.runTransition`).
 */
export interface ActivityContext {
  readonly workflowId: string;
  readonly runId: string;
  readonly stepIdx: number;
  /** 0-based retry index. 0 = first try. */
  readonly attempt: number;
  /** Deterministic per-step idempotency key: `${runId}:step:${stepIdx}`. */
  readonly opKey: string;
}

/**
 * Per-verb activity implementation. Throwing (sync or async) is how an
 * activity signals failure. Retryable failures attach a `.code` property
 * readable from a thrown `Error` (e.g. `{ code: 'rate_limited' }`);
 * `def.retry.nonRetryable` matches on that code to short-circuit a retry
 * loop. Anything in `nonRetryable` promotes to `step_failed` on first
 * throw; everything else retries up to `def.retry.maxAttempts`.
 *
 * A return value is ignored — the event log is the durable record of
 * success, not the activity's return.
 */
export type ActivityFn = (
  step: Extract<WorkflowStep, { kind: 'action' }>,
  ctx: RunContext,
  actCtx: ActivityContext
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
   * Verb → activity dispatcher. Absent → action steps fall through as
   * no-ops (pre-C2 behavior). `bootRuntime` supplies
   * `DEFAULT_ACTIVITIES` from `workflow-activities.ts`; tests inject
   * throwing variants to exercise retry + failure paths.
   */
  readonly activities?: ActivityRegistry;
  /**
   * Sleep override for deterministic tests. Defaults to real
   * `setTimeout`. Tests pass `async () => {}` so retry backoff is
   * instantaneous.
   */
  readonly sleep?: (ms: number) => Promise<void>;
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
      // T9: surface the discrete terminal label so dashboards can
      // partition `failed` (dispatcher crashed) from `dropped`
      // (filter said no) from `queued`/`handed-off`/`escalated`
      // (intentional routes). Before this, any non-'ok' run lumped
      // together as "status=failed" regardless of why.
      disposition: result.disposition,
    },
  });
  return result;
}

// Activity retry loop. Runs the activity up to `def.retry.maxAttempts`;
// backs off by `initialBackoffMs * multiplier^(attempt-1)` per attempt;
// short-circuits on codes in `nonRetryable`. Returns null on success,
// `{code,message}` on terminal failure — the caller writes the event.
async function dispatchActivityWithRetry(
  step: Extract<WorkflowStep, { kind: 'action' }>,
  stepIdx: number,
  ctx: RunContext,
  def: WorkflowDefinition,
  activity: ActivityFn
): Promise<{ code: string; message: string } | null> {
  const retry = def.retry;
  const sleep = ctx.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const opKey = `${ctx.runId}:step:${stepIdx}`;
  let lastCode = 'activity_threw';
  let lastMessage = 'activity failed';
  for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
    try {
      await activity(step, ctx, {
        workflowId: def.id,
        runId: ctx.runId,
        stepIdx,
        attempt,
        opKey,
      });
      return null;
    } catch (cause) {
      lastCode =
        typeof cause === 'object' && cause && 'code' in cause
          ? String((cause as { code: unknown }).code)
          : 'activity_threw';
      lastMessage = cause instanceof Error ? cause.message : 'activity failed';
      // Permanent code → don't consume further attempts.
      if (retry.nonRetryable.includes(lastCode)) break;
      // Exhausted → fall through to return below.
      if (attempt === retry.maxAttempts - 1) break;
      const backoff = retry.initialBackoffMs * retry.backoffMultiplier ** attempt;
      await sleep(backoff);
    }
  }
  return { code: lastCode, message: lastMessage };
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

    // Activity dispatch (T3): only `action` steps whose verb is registered
    // run a real function. Unregistered verbs fall through as no-ops so a
    // partially-wired activity table doesn't break untested workflows.
    //
    // Retries are bounded by `def.retry.maxAttempts`. Thrown errors whose
    // `.code` is in `def.retry.nonRetryable` promote to `step_failed` on
    // first throw — matches the schedule registry's retry discipline.
    // Per-step opKey is `${runId}:step:${idx}` — the same idempotency
    // key every retry attempt sees, so an activity that enqueues an
    // outbox mutation (say) can't double-write across retries.
    if (step.kind === 'action') {
      const activity = ctx.activities?.[step.verb];
      if (activity) {
        const failure = await dispatchActivityWithRetry(step, i, ctx, def, activity);
        if (failure) {
          events.push({
            kind: 'workflow.step_failed',
            at: nowFn(),
            stepIdx: i,
            stepKind: step.kind,
            code: failure.code,
            message: failure.message,
          });
          steps.push({
            idx: i,
            kind: step.kind,
            outcome: 'failed',
            label: step.label,
            ms: 0,
            error: failure.message,
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
