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

// ─── Deterministic run-id (T6) ─────────────────────────────────────────────
//
// Runs are identified by the tuple `(workflowId, source, time-bucket,
// payload)`. Hashing that tuple means two fire events from the same
// trigger in the same bucket collide on the same `runId` — and the
// first-append gate (T7) turns the second into a read-only replay
// instead of a duplicate run. Pre-T6, the demo timer used
// `Date.now().toString(36)` which could collide silently under load
// (two firings in the same millisecond) and, worse, did NOT collide
// under normal schedule cadence — so the same trigger produced a
// fresh run every minute.
//
// Hash is djb2 — 32-bit, no crypto dependency, suitable for the demo's
// dedup window. Real deployments can upgrade to a SubtleCrypto digest
// for broader uniqueness; the surface is identical.

export function deterministicRunId(
  workflowId: string,
  source: string,
  at: Instant,
  payload: Readonly<Record<string, unknown>>,
  bucketMs = 60_000
): string {
  const bucket = Math.floor(new Date(at.iso).getTime() / bucketMs);
  // Stable stringification — sorted keys so `{a,b}` and `{b,a}` hash to
  // the same value.
  const keys = Object.keys(payload).sort();
  const stable: Record<string, unknown> = {};
  for (const k of keys) stable[k] = payload[k];
  const seed = `${workflowId}|${source}|${bucket}|${JSON.stringify(stable)}`;
  return `run_${djb2Hex(seed)}`;
}

function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i); // h * 33 ^ c
  return (h >>> 0).toString(16).padStart(8, '0');
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
      : // eslint-disable-next-line no-restricted-syntax -- wall-clock fallback for elapsed-ms telemetry only. Not persisted, not replayed — `t0` only feeds `workflow.completed.ms`. Runner's event timestamps use `ctx.now ?? nowInstant()`, which is what the T10 rule protects.
        Date.now();
  const stream = workflowRunStream(def.id, ctx.runId);
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
    // T1 + T7: re-entrant run with race-safe first-append gate.
    //
    // Every invocation reads the stream first so it can distinguish
    // three states: (a) empty → fresh start, gated via `appendIf(empty)`
    // so two concurrent starters for the same runId can't both commit
    // `run_started`; (b) has `run_started`, tail is an un-resumed
    // `wait_armed` → resume path (timer elapsed → emit `wait_resumed`
    // + remaining steps, else return current waiting state); (c) has
    // `run_completed` → read-only replay.
    //
    // Resuming appends new events with `opKey: ${runId}:${offset + idx}`
    // where offset = existing.length. Storage idempotency on
    // (stream, opKey) means an accidental double-resume collides
    // harmlessly instead of writing dup events with shifted indices.
    async () => runReentrant(def, ctx, log, stream)
  )) as RunResult;
  const t1 =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : // eslint-disable-next-line no-restricted-syntax -- same as t0 above: elapsed-ms telemetry only, never replayed.
        Date.now();
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

// ─── re-entrant orchestration (T1 + T7) ────────────────────────────────────
//
// `run()` delegates here so the startSpan wrapper stays thin. This layer
// inspects the existing stream, decides fresh-start vs resume vs
// already-terminal, and is the single writer of new events.

async function runReentrant(
  def: WorkflowDefinition,
  ctx: RunContext,
  log: EventLog,
  stream: ReturnType<typeof workflowRunStream>
): Promise<RunResult> {
  const existing = await log.read(stream);
  const runEvents = existing
    .map((e) => e.payload)
    .filter((p) => p.kind.startsWith('workflow.')) as WorkflowRunEvent[];

  // (c) Already terminal → read-only replay.
  if (runEvents.some((e) => e.kind === 'workflow.run_completed')) {
    return replay(def, existing) ?? synthesizeFallback(def, ctx);
  }

  // (b) Has `run_started`? If so, the only legitimate paused state is a
  // tail `wait_armed` without a matching `wait_resumed`. Any other mid-
  // state is a runner/crash artifact — we replay what we have and stop.
  if (runEvents.some((e) => e.kind === 'workflow.run_started')) {
    const armed = runEvents.filter((e) => e.kind === 'workflow.wait_armed');
    const lastArmed = armed[armed.length - 1];
    if (!lastArmed || lastArmed.kind !== 'workflow.wait_armed') {
      return replay(def, existing) ?? synthesizeFallback(def, ctx);
    }
    const resumedIdxs = new Set(
      runEvents
        .filter((e) => e.kind === 'workflow.wait_resumed')
        .map((e) => (e.kind === 'workflow.wait_resumed' ? e.stepIdx : -1))
    );
    const runVersion = readRunVersion(runEvents, def);
    if (resumedIdxs.has(lastArmed.stepIdx)) {
      // Paused at a later point? Re-run from lastArmed.stepIdx+1.
      // Uncommon: happens if a prior resume was interrupted after
      // writing wait_resumed but before writing subsequent events.
      return await continueFrom(
        def,
        ctx,
        log,
        stream,
        existing,
        lastArmed.stepIdx + 1,
        null,
        runVersion
      );
    }

    // Tail wait_armed unresumed. Fire only if the timer has elapsed.
    const now = new Date((ctx.now ?? nowInstant)().iso).getTime();
    const fireAtMs = new Date(lastArmed.fireAt.iso).getTime();
    if (now < fireAtMs) {
      // Still waiting — return current state, write nothing.
      return replay(def, existing) ?? synthesizeFallback(def, ctx);
    }

    return await continueFrom(
      def,
      ctx,
      log,
      stream,
      existing,
      lastArmed.stepIdx + 1,
      lastArmed.stepIdx,
      runVersion
    );
  }

  // (a) Fresh start — gate the first write on "stream is empty". Losing
  // the race means another starter committed first; fall through to a
  // read-and-replay path so the caller gets the winner's result shape.
  const planned = await planSteps(def, ctx, 0, {
    emitStarted: true,
    resumedFromIdx: null,
    runVersion: def.version,
  });
  const inputs = planned.events.map((payload, i) => ({
    opKey: `${ctx.runId}:${i}`,
    payload,
  }));
  const res = await log.appendIf(stream, inputs, (prev) => prev.length === 0);
  if (!res.ok && res.code === 'optimistic_lock_failure') {
    const winner = await log.read(stream);
    return replay(def, winner) ?? synthesizeFallback(def, ctx);
  }
  if (!res.ok) {
    // Storage/validation error — surface as synthetic failure. Telemetry
    // in the outer `run()` still fires so operators see the anomaly.
    return synthesizeFallback(def, ctx);
  }
  const after = await log.read(stream);
  return replay(def, after) ?? synthesizeFallback(def, ctx);
}

async function continueFrom(
  def: WorkflowDefinition,
  ctx: RunContext,
  log: EventLog,
  stream: ReturnType<typeof workflowRunStream>,
  existing: readonly StoredEvent[],
  startAt: number,
  resumedFromIdx: number | null,
  runVersion: number
): Promise<RunResult> {
  const planned = await planSteps(def, ctx, startAt, {
    emitStarted: false,
    resumedFromIdx,
    runVersion,
  });
  if (planned.events.length === 0) {
    return replay(def, existing) ?? synthesizeFallback(def, ctx);
  }
  const offset = existing.length;
  const inputs = planned.events.map((payload, i) => ({
    opKey: `${ctx.runId}:${offset + i}`,
    payload,
  }));
  await log.append(stream, inputs);
  const after = await log.read(stream);
  return replay(def, after) ?? synthesizeFallback(def, ctx);
}

// Pull the `version` off of the original `run_started` event so resumes
// pin to the version the run was started on, not the current def.version
// (T8). Falls back to def.version if the event is missing (shouldn't
// happen in practice).
function readRunVersion(runEvents: readonly WorkflowRunEvent[], def: WorkflowDefinition): number {
  const started = runEvents.find((e) => e.kind === 'workflow.run_started');
  return started && started.kind === 'workflow.run_started' ? started.version : def.version;
}

// Fallback when an unexpected append error prevents a normal replay. The
// run doesn't advance; the caller gets a shape-correct result so
// telemetry + callers don't crash.
function synthesizeFallback(def: WorkflowDefinition, ctx: RunContext): RunResult {
  return {
    runId: ctx.runId,
    workflowId: def.id,
    version: def.version,
    disposition: 'failed',
    steps: [],
    totalMs: 0,
    events: [],
  };
}

// Plan the new events to append from `startAt` forward. Pure with respect
// to storage — returns the event sequence the caller then writes. Emits
// `run_started` only if `emitStarted` (fresh-start path); emits
// `wait_resumed` at the head if `resumedFromIdx` is set (resume path).
//
// `runVersion` gates T8's step filter: steps whose `introducedAt`
// exceeds `runVersion` are skipped silently (no event, no trace entry),
// matching Temporal's `workflow.patched()` contract. A fresh start
// always passes `runVersion = def.version`; a resume reads it from the
// original `workflow.run_started` so new steps added after the run
// began don't retroactively alter its execution.
async function planSteps(
  def: WorkflowDefinition,
  ctx: RunContext,
  startAt: number,
  opts: {
    emitStarted: boolean;
    resumedFromIdx: number | null;
    runVersion: number;
  }
): Promise<{ events: WorkflowRunEvent[] }> {
  const nowFn = ctx.now ?? nowInstant;
  const events: WorkflowRunEvent[] = [];
  if (opts.emitStarted) {
    events.push({
      kind: 'workflow.run_started',
      at: nowFn(),
      version: def.version,
      trigger: (def.steps[0] as { source?: string }).source ?? 'manual',
    });
  }
  if (opts.resumedFromIdx !== null) {
    events.push({
      kind: 'workflow.wait_resumed',
      at: nowFn(),
      stepIdx: opts.resumedFromIdx,
      cause: 'timer',
    });
  }

  let disposition: Disposition = 'dropped';
  let failed = false;
  let waited = false;
  let terminated = false;

  stepLoop: for (let i = startAt; i < def.steps.length; i++) {
    const step = def.steps[i];

    // T8: skip steps newer than the run's pinned version. `introducedAt`
    // absent ↔ step has existed since version 1 (pre-T8 definitions).
    if (step.introducedAt !== undefined && step.introducedAt > opts.runVersion) {
      continue;
    }

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
          failed = true;
          break stepLoop;
        }
      }
    }

    if (step.kind === 'wait') {
      const at = nowFn();
      const fireAt: Instant = {
        iso: new Date(new Date(at.iso).getTime() + step.durationMs).toISOString(),
      };
      events.push({
        kind: 'workflow.wait_armed',
        at,
        stepIdx: i,
        fireAt,
        // Copy into a mutable array — the event-log's validated shape is
        // `string[]`, and `step.resumeOn` is `readonly string[]`.
        resumeOn: step.resumeOn ? [...step.resumeOn] : [],
      });
      waited = true;
      break stepLoop;
    }

    const outcome = executeStep(step, ctx);
    const at = nowFn();
    events.push({
      kind: 'workflow.step_executed',
      at,
      stepIdx: i,
      stepKind: step.kind,
      outcome: outcome === 'ok' ? 'ok' : 'skip',
      ms: 0,
    });
    if (outcome === 'skip') {
      disposition = 'dropped';
      terminated = true;
      break stepLoop;
    }
    if (step.kind === 'end') {
      disposition = step.disposition;
      terminated = true;
      break stepLoop;
    }
  }

  if (failed) {
    events.push({ kind: 'workflow.run_completed', at: nowFn(), disposition: 'failed' });
  } else if (terminated) {
    events.push({ kind: 'workflow.run_completed', at: nowFn(), disposition });
  }
  // waited && !terminated && !failed → no run_completed event; the
  // tail wait_armed is the marker that a later resume will continue
  // from.
  void waited;
  return { events };
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

  // Build a quick lookup so wait_armed can know whether its twin
  // wait_resumed exists elsewhere in the stream.
  const resumedStepIdxs = new Set<number>(
    runEvents
      .filter((e) => e.kind === 'workflow.wait_resumed')
      .map((e) => (e.kind === 'workflow.wait_resumed' ? e.stepIdx : -1))
  );

  const steps: RunStepTrace[] = [];
  for (const e of runEvents) {
    if (e.kind === 'workflow.step_executed') {
      const defStep = def.steps[e.stepIdx];
      const label = defStep?.label ?? '(unknown)';
      // Legacy: pre-T1 runs wrote wait-steps as `step_executed` with
      // outcome 'skip'. Post-T1 runs write `wait_armed` instead (handled
      // below). Keep this branch so old streams still reconstruct
      // correctly.
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
    } else if (e.kind === 'workflow.wait_armed') {
      const defStep = def.steps[e.stepIdx];
      // An armed wait with a matching wait_resumed later in the stream
      // materialises as an 'ok' trace — the wait step ran to completion.
      // Without a resume, it stays 'wait' and the run disposition is
      // 'waiting' below.
      steps.push({
        idx: e.stepIdx,
        kind: (defStep?.kind ?? 'wait') as WorkflowStep['kind'],
        outcome: resumedStepIdxs.has(e.stepIdx) ? 'ok' : 'wait',
        label: defStep?.label ?? '(unknown)',
        ms: 0,
      });
    }
    // `workflow.wait_resumed` has no direct trace entry — its effect is
    // folded into the corresponding `wait_armed` above.
  }

  // Parse runId from the stream key: "workflow:<wfId>:run:<runId>"
  const streamParts = (events[0]?.stream as string | undefined)?.split(':') ?? [];
  const runId = streamParts[3] ?? 'unknown';

  // A stream with an un-resumed wait_armed OR a tail 'wait' trace (legacy
  // step_executed-as-wait) counts as waiting if no run_completed is on
  // the wire. The two checks are belt + suspenders: new runs use
  // wait_armed; old runs live on step_executed.
  const hasUnresumedWait = runEvents.some(
    (e) => e.kind === 'workflow.wait_armed' && !resumedStepIdxs.has(e.stepIdx)
  );
  const tailIsWait = steps[steps.length - 1]?.outcome === 'wait';
  const disposition: RunResult['disposition'] =
    completed && completed.kind === 'workflow.run_completed'
      ? (completed.disposition as Disposition)
      : hasUnresumedWait || tailIsWait
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
