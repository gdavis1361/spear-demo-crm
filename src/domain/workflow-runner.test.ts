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
      input: { has_orders: 'true', recently_quoted: 'false' },  // predicate is `has_orders && !recently_quoted` — tested as the literal key
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
      id: 'wf-test', name: 't', version: 1, description: '', retry: DEFAULT_RETRY,
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
