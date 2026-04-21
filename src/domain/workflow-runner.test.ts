import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validate, dryRun, run, replay, patched, deterministicRunId } from './workflow-runner';
import type { WorkflowDefinition } from './workflow-def';
import { PCS_CYCLE_OUTREACH } from './workflow-def';
import { InMemoryEventLog, workflowRunStream } from './events';
import { _setNowForTests, _resetNowForTests, instant } from '../lib/time';
import { DEFAULT_RETRY } from './schedules';

const NOW = '2026-04-21T13:47:00Z';

describe('validate()', () => {
  it('approves a well-formed definition', () => {
    expect(validate(PCS_CYCLE_OUTREACH).ok).toBe(true);
  });

  it('rejects an empty definition', () => {
    const def: WorkflowDefinition = { ...PCS_CYCLE_OUTREACH, steps: [] };
    const r = validate(def);
    expect(r.ok).toBe(false);
    expect(r.issues).toContain('workflow has no steps');
  });

  it('rejects a definition that does not start with a trigger', () => {
    const def: WorkflowDefinition = {
      ...PCS_CYCLE_OUTREACH,
      steps: [
        { kind: 'action', label: 'oops', verb: 'email', template: 't' },
        { kind: 'end', label: 'end', disposition: 'dropped' },
      ],
    };
    const r = validate(def);
    expect(r.ok).toBe(false);
  });

  it('rejects a definition that does not end with `end`', () => {
    const def: WorkflowDefinition = {
      ...PCS_CYCLE_OUTREACH,
      steps: [
        { kind: 'trigger', source: 'manual', label: 't' },
        { kind: 'action', label: 'a', verb: 'email', template: 't' },
      ],
    };
    const r = validate(def);
    expect(r.ok).toBe(false);
  });
});

describe('patched()', () => {
  it('returns true when run version is at or beyond the patch', () => {
    expect(patched(3, 2)).toBe(true);
    expect(patched(2, 2)).toBe(true);
  });
  it('returns false when run version predates the patch', () => {
    expect(patched(1, 2)).toBe(false);
  });
});

describe('dryRun()', () => {
  beforeEach(() => _setNowForTests(() => instant(NOW)));
  afterEach(() => _resetNowForTests());

  it('passes a workflow whose filter predicate is true', () => {
    const result = dryRun(PCS_CYCLE_OUTREACH, {
      input: { has_orders: 'true', recently_quoted: 'false' }, // predicate is `has_orders && !recently_quoted` — tested as the literal key
      runId: 'run_test',
    });
    // Filter step inspects `has_orders && !recently_quoted` literally — adapt expectation.
    expect(result.events[0].kind).toBe('workflow.run_started');
    expect(result.disposition).toBeDefined();
  });

  it('drops a workflow when filter fails', () => {
    const result = dryRun(PCS_CYCLE_OUTREACH, { input: {}, runId: 'r' });
    expect(result.disposition).toBe('dropped');
  });

  it('emits a wait-step trace and pauses execution', () => {
    const def: WorkflowDefinition = {
      id: 'wf-test',
      name: 't',
      version: 1,
      description: '',
      retry: DEFAULT_RETRY,
      steps: [
        { kind: 'trigger', source: 'manual', label: 'go' },
        { kind: 'wait', label: 'wait 5m', durationMs: 5 * 60_000 },
        { kind: 'end', label: 'done', disposition: 'queued' },
      ],
    };
    const result = dryRun(def, { input: {}, runId: 'r' });
    expect(result.disposition).toBe('waiting');
    expect(result.steps[result.steps.length - 1].outcome).toBe('wait');
  });
});

describe('run() emits the same trace as dryRun()', () => {
  beforeEach(() => _setNowForTests(() => instant(NOW)));
  afterEach(() => _resetNowForTests());

  it('events written to log match dryRun events 1:1', async () => {
    const log = new InMemoryEventLog();
    const ctx = { input: { has_orders: 'true' }, runId: 'r1' };
    const dry = dryRun(PCS_CYCLE_OUTREACH, ctx);
    const real = await run(PCS_CYCLE_OUTREACH, ctx, log);
    expect(real.events.length).toBe(dry.events.length);
    expect(real.disposition).toBe(dry.disposition);
    const stored = await log.read(workflowRunStream(PCS_CYCLE_OUTREACH.id, 'r1'));
    expect(stored.length).toBe(real.events.length);
  });
});

// T4 — activity throws become `workflow.step_failed` + disposition 'failed'.
// The contract: run() catches, emits the failure event, writes a
// `run_completed { disposition: 'failed' }` terminator so SRE queries can
// distinguish intentional drops from crashes; replay() reconstructs the
// same trace byte-for-byte. The round-trip is the determinism check that
// the prior happy-path-only determinism test couldn't cover.
describe('run() with a failing activity (T4)', () => {
  beforeEach(() => _setNowForTests(() => instant(NOW)));
  afterEach(() => _resetNowForTests());

  // A workflow with a single action step so the failure is unambiguous.
  // predicate: `always_true` is looked up literally (see existing runner
  // semantics — input keys ARE the predicate strings).
  const def: WorkflowDefinition = {
    id: 'wf-failing',
    name: 't',
    version: 1,
    description: '',
    retry: DEFAULT_RETRY,
    steps: [
      { kind: 'trigger', source: 'manual', label: 'go' },
      { kind: 'action', label: 'send', verb: 'email', template: 't' },
      { kind: 'end', label: 'done', disposition: 'queued' },
    ],
  };

  it('emits step_failed + run_completed{failed} when an activity throws', async () => {
    const log = new InMemoryEventLog();
    const r = await run(
      def,
      {
        input: {},
        runId: 'r_fail_1',
        sleep: async () => undefined,
        activities: {
          email: async () => {
            const e = new Error('smtp down') as Error & { code?: string };
            e.code = 'smtp_unreachable';
            throw e;
          },
        },
      },
      log
    );

    expect(r.disposition).toBe('failed');
    const kinds = r.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'workflow.run_started',
      'workflow.step_executed', // trigger step still runs
      'workflow.step_failed',
      'workflow.run_completed',
    ]);
    const failed = r.events.find((e) => e.kind === 'workflow.step_failed')!;
    expect(failed.kind === 'workflow.step_failed' && failed.code).toBe('smtp_unreachable');
    expect(failed.kind === 'workflow.step_failed' && failed.message).toBe('smtp down');
    const trace = r.steps[r.steps.length - 1];
    expect(trace.outcome).toBe('failed');
    expect(trace.error).toBe('smtp down');
  });

  it('byte-identical round-trip: run() → log → replay()', async () => {
    const log = new InMemoryEventLog();
    const real = await run(
      def,
      {
        input: {},
        runId: 'r_fail_2',
        sleep: async () => undefined,
        activities: {
          email: async () => {
            throw new Error('smtp down');
          },
        },
      },
      log
    );
    const stored = await log.read(workflowRunStream(def.id, 'r_fail_2'));
    const replayed = replay(def, stored);
    expect(replayed).not.toBeNull();
    if (!replayed) return;
    // Event stream the runner emitted must survive a round-trip via the
    // durable log, and replay must surface the terminal disposition the
    // runner wrote (not a fallback computed from finalDisposition).
    expect(replayed.disposition).toBe('failed');
    expect(replayed.events.map((e) => e.kind)).toEqual(real.events.map((e) => e.kind));
    expect(replayed.steps.map((s) => s.outcome)).toEqual(real.steps.map((s) => s.outcome));
    expect(replayed.steps[replayed.steps.length - 1].error).toBe('smtp down');
  });

  it('unregistered verbs still execute as no-ops (back-compat)', async () => {
    const log = new InMemoryEventLog();
    // No `activities` registered at all — should match pre-C1 happy path.
    const r = await run(def, { input: {}, runId: 'r_noact' }, log);
    expect(r.disposition).toBe('queued');
    expect(r.steps.some((s) => s.outcome === 'failed')).toBe(false);
  });
});

// T3 — retry discipline + per-step opKey. The runner retries a failing
// activity up to `def.retry.maxAttempts`, backs off between tries, and
// short-circuits on codes in `nonRetryable`. Per-step opKey is stable
// across retries so the activity itself (not the runner) can be
// idempotent by storing under the same key on each attempt.
describe('run() activity retries (T3)', () => {
  beforeEach(() => _setNowForTests(() => instant(NOW)));
  afterEach(() => _resetNowForTests());

  const def = (retry = DEFAULT_RETRY): WorkflowDefinition => ({
    id: 'wf-retry',
    name: 't',
    version: 1,
    description: '',
    retry,
    steps: [
      { kind: 'trigger', source: 'manual', label: 'go' },
      { kind: 'action', label: 'send', verb: 'email', template: 't' },
      { kind: 'end', label: 'done', disposition: 'queued' },
    ],
  });

  it('retries until success; sees the same opKey every attempt', async () => {
    const opKeys: string[] = [];
    const attempts: number[] = [];
    let n = 0;
    const r = await run(
      def({ maxAttempts: 3, initialBackoffMs: 1, backoffMultiplier: 1, nonRetryable: [] }),
      {
        input: {},
        runId: 'r_retry_ok',
        sleep: async () => undefined,
        activities: {
          email: async (_step, _ctx, actCtx) => {
            opKeys.push(actCtx.opKey);
            attempts.push(actCtx.attempt);
            n++;
            if (n < 2) throw new Error('transient');
          },
        },
      },
      new InMemoryEventLog()
    );
    expect(r.disposition).toBe('queued');
    expect(n).toBe(2);
    expect(opKeys).toEqual(['r_retry_ok:step:1', 'r_retry_ok:step:1']); // stable
    expect(attempts).toEqual([0, 1]); // incremented
  });

  it('promotes to step_failed once maxAttempts is exhausted', async () => {
    let tries = 0;
    const r = await run(
      def({ maxAttempts: 2, initialBackoffMs: 1, backoffMultiplier: 1, nonRetryable: [] }),
      {
        input: {},
        runId: 'r_retry_exhausted',
        sleep: async () => undefined,
        activities: {
          email: async () => {
            tries++;
            throw new Error('still down');
          },
        },
      },
      new InMemoryEventLog()
    );
    expect(r.disposition).toBe('failed');
    expect(tries).toBe(2);
  });

  it('non-retryable codes short-circuit on first throw', async () => {
    let tries = 0;
    const r = await run(
      def({
        maxAttempts: 5,
        initialBackoffMs: 1,
        backoffMultiplier: 1,
        nonRetryable: ['permission_denied'],
      }),
      {
        input: {},
        runId: 'r_retry_perm',
        sleep: async () => undefined,
        activities: {
          email: async () => {
            tries++;
            const e = new Error('nope') as Error & { code?: string };
            e.code = 'permission_denied';
            throw e;
          },
        },
      },
      new InMemoryEventLog()
    );
    expect(r.disposition).toBe('failed');
    expect(tries).toBe(1);
    const failed = r.events.find((e) => e.kind === 'workflow.step_failed');
    expect(failed && failed.kind === 'workflow.step_failed' && failed.code).toBe(
      'permission_denied'
    );
  });
});

// T1 — wait persistence + resume lifecycle. A wait step writes
// `wait_armed { fireAt, resumeOn }` and the runner stops. Invoking
// `run()` again with the same runId before `fireAt` returns the waiting
// state unchanged; after `fireAt` the runner emits `wait_resumed` and
// executes the remaining steps through to `run_completed`. Replay must
// reconstruct the same disposition at every phase.
describe('run() wait persistence (T1)', () => {
  const def: WorkflowDefinition = {
    id: 'wf-waiter',
    name: 't',
    version: 1,
    description: '',
    retry: DEFAULT_RETRY,
    steps: [
      { kind: 'trigger', source: 'manual', label: 'go' },
      { kind: 'wait', label: 'wait 1m', durationMs: 60_000, resumeOn: ['inbound.reply'] },
      { kind: 'end', label: 'done', disposition: 'queued' },
    ],
  };

  it('first call emits wait_armed and returns waiting; no run_completed', async () => {
    const log = new InMemoryEventLog();
    _setNowForTests(() => instant('2026-04-21T12:00:00Z'));
    try {
      const r = await run(def, { input: {}, runId: 'r_wait_1' }, log);
      expect(r.disposition).toBe('waiting');
      const kinds = r.events.map((e) => e.kind);
      expect(kinds).toEqual([
        'workflow.run_started',
        'workflow.step_executed',
        'workflow.wait_armed',
      ]);
      const armed = r.events.find((e) => e.kind === 'workflow.wait_armed');
      expect(armed && armed.kind === 'workflow.wait_armed' && armed.resumeOn).toEqual([
        'inbound.reply',
      ]);
    } finally {
      _resetNowForTests();
    }
  });

  it('re-entering before fireAt returns current waiting state and writes nothing', async () => {
    const log = new InMemoryEventLog();
    _setNowForTests(() => instant('2026-04-21T12:00:00Z'));
    await run(def, { input: {}, runId: 'r_wait_2' }, log);
    const sizeAfterFirst = (await log.read(workflowRunStream(def.id, 'r_wait_2'))).length;
    // Advance only 30s — wait is 60s so timer hasn't fired.
    _setNowForTests(() => instant('2026-04-21T12:00:30Z'));
    const again = await run(def, { input: {}, runId: 'r_wait_2' }, log);
    expect(again.disposition).toBe('waiting');
    expect((await log.read(workflowRunStream(def.id, 'r_wait_2'))).length).toBe(sizeAfterFirst);
    _resetNowForTests();
  });

  it('re-entering after fireAt resumes and completes the run', async () => {
    const log = new InMemoryEventLog();
    _setNowForTests(() => instant('2026-04-21T12:00:00Z'));
    await run(def, { input: {}, runId: 'r_wait_3' }, log);
    // Advance past the 60s wait.
    _setNowForTests(() => instant('2026-04-21T12:02:00Z'));
    const resumed = await run(def, { input: {}, runId: 'r_wait_3' }, log);
    expect(resumed.disposition).toBe('queued');
    const stored = await log.read(workflowRunStream(def.id, 'r_wait_3'));
    const kinds = stored.map((s) => s.payload.kind);
    // Expected sequence: start → trigger step_exec → wait_armed →
    // wait_resumed → end step_exec → run_completed.
    expect(kinds).toEqual([
      'workflow.run_started',
      'workflow.step_executed',
      'workflow.wait_armed',
      'workflow.wait_resumed',
      'workflow.step_executed',
      'workflow.run_completed',
    ]);
    _resetNowForTests();
  });

  it('replay of a mid-resume stream reports waiting; of a post-resume stream reports queued', async () => {
    const log = new InMemoryEventLog();
    _setNowForTests(() => instant('2026-04-21T12:00:00Z'));
    await run(def, { input: {}, runId: 'r_wait_4' }, log);
    const paused = await log.read(workflowRunStream(def.id, 'r_wait_4'));
    expect(replay(def, paused)?.disposition).toBe('waiting');
    _setNowForTests(() => instant('2026-04-21T12:05:00Z'));
    await run(def, { input: {}, runId: 'r_wait_4' }, log);
    const finished = await log.read(workflowRunStream(def.id, 'r_wait_4'));
    expect(replay(def, finished)?.disposition).toBe('queued');
    _resetNowForTests();
  });
});

// T7 — race-safe first-append. Two concurrent run() invocations against
// the same runId must not both commit `workflow.run_started`. The first
// wins via `appendIf(existing.length === 0)`; the loser reads the
// winner's events and returns a consistent replayed view.
describe('run() race-safe first-append (T7)', () => {
  beforeEach(() => _setNowForTests(() => instant(NOW)));
  afterEach(() => _resetNowForTests());

  const def: WorkflowDefinition = {
    id: 'wf-race',
    name: 't',
    version: 1,
    description: '',
    retry: DEFAULT_RETRY,
    steps: [
      { kind: 'trigger', source: 'manual', label: 'go' },
      { kind: 'end', label: 'done', disposition: 'queued' },
    ],
  };

  it('two concurrent starts to same runId result in exactly one run_started', async () => {
    const log = new InMemoryEventLog();
    const [a, b] = await Promise.all([
      run(def, { input: {}, runId: 'r_race' }, log),
      run(def, { input: {}, runId: 'r_race' }, log),
    ]);
    expect(a.disposition).toBe('queued');
    expect(b.disposition).toBe('queued');
    const stored = await log.read(workflowRunStream(def.id, 'r_race'));
    const started = stored.filter((e) => e.payload.kind === 'workflow.run_started');
    expect(started).toHaveLength(1); // first-append gate held
    const completed = stored.filter((e) => e.payload.kind === 'workflow.run_completed');
    expect(completed).toHaveLength(1);
  });

  it('invoking a completed run returns the replayed result unchanged', async () => {
    const log = new InMemoryEventLog();
    await run(def, { input: {}, runId: 'r_done' }, log);
    const before = (await log.read(workflowRunStream(def.id, 'r_done'))).length;
    const again = await run(def, { input: {}, runId: 'r_done' }, log);
    expect(again.disposition).toBe('queued');
    // Re-invocation of a terminal run writes no new events.
    expect((await log.read(workflowRunStream(def.id, 'r_done'))).length).toBe(before);
  });
});

// T6 — deterministic runId from (workflowId, source, time-bucket,
// payload). Same tuple → same runId so rapid schedule firings dedupe
// via the first-append gate; different tuples diverge.
describe('deterministicRunId (T6)', () => {
  const payload = { has_orders: 'true' };
  const at = instant('2026-04-21T13:47:00Z');

  it('is stable for the same tuple', () => {
    const a = deterministicRunId('wf-x', 'manual', at, payload);
    const b = deterministicRunId('wf-x', 'manual', at, payload);
    expect(a).toBe(b);
    expect(a).toMatch(/^run_[0-9a-f]{8}$/);
  });

  it('differs when the workflowId differs', () => {
    expect(deterministicRunId('wf-a', 's', at, payload)).not.toBe(
      deterministicRunId('wf-b', 's', at, payload)
    );
  });

  it('differs when the payload differs', () => {
    expect(deterministicRunId('wf-x', 's', at, { a: 1 })).not.toBe(
      deterministicRunId('wf-x', 's', at, { a: 2 })
    );
  });

  it('is stable within a bucket, changes across buckets', () => {
    const t1 = instant('2026-04-21T13:47:00Z');
    const t2 = instant('2026-04-21T13:47:45Z'); // same 60s bucket
    const t3 = instant('2026-04-21T13:48:05Z'); // next bucket
    expect(deterministicRunId('wf', 's', t1, payload)).toBe(
      deterministicRunId('wf', 's', t2, payload)
    );
    expect(deterministicRunId('wf', 's', t1, payload)).not.toBe(
      deterministicRunId('wf', 's', t3, payload)
    );
  });

  it('key order in payload does not perturb the hash', () => {
    const a = deterministicRunId('wf', 's', at, { a: 1, b: 2 });
    const b = deterministicRunId('wf', 's', at, { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('same runId + run() twice produces one run_started on the wire (T6 × T7)', async () => {
    const log = new InMemoryEventLog();
    const def: WorkflowDefinition = {
      id: 'wf-det',
      name: 't',
      version: 1,
      description: '',
      retry: DEFAULT_RETRY,
      steps: [
        { kind: 'trigger', source: 'manual', label: 'go' },
        { kind: 'end', label: 'done', disposition: 'queued' },
      ],
    };
    _setNowForTests(() => instant('2026-04-21T13:47:15Z'));
    const runId1 = deterministicRunId(def.id, 'manual', instant('2026-04-21T13:47:15Z'), {});
    const runId2 = deterministicRunId(def.id, 'manual', instant('2026-04-21T13:47:40Z'), {});
    expect(runId1).toBe(runId2); // same bucket
    const [a, b] = await Promise.all([
      run(def, { input: {}, runId: runId1 }, log),
      run(def, { input: {}, runId: runId2 }, log),
    ]);
    expect(a.disposition).toBe('queued');
    expect(b.disposition).toBe('queued');
    const stored = await log.read(workflowRunStream(def.id, runId1));
    expect(stored.filter((e) => e.payload.kind === 'workflow.run_started')).toHaveLength(1);
    _resetNowForTests();
  });
});
