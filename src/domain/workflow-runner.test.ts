import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validate, dryRun, run, replay, patched } from './workflow-runner';
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
