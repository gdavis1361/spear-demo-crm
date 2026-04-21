import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { run, replay } from './workflow-runner';
import { PCS_CYCLE_OUTREACH, type WorkflowDefinition } from './workflow-def';
import { InMemoryEventLog, workflowRunStream } from './events';
import { _setNowForTests, _resetNowForTests, instant } from '../lib/time';
import { DEFAULT_RETRY } from './schedules';

const NOW = '2026-04-21T13:47:00Z';

/**
 * The determinism contract: given a frozen event log, `replay(def, events)`
 * must produce a RunResult whose business-relevant fields (steps, version,
 * disposition, event sequence) are byte-identical to the live `run(...)`
 * that produced that log.
 *
 * This is the single most important test in the codebase: it asserts that
 * a workflow's behavior is fully derivable from its history — which is
 * exactly what makes durable execution possible.
 */
describe('Replay determinism', () => {
  beforeEach(() => _setNowForTests(() => instant(NOW)));
  afterEach(() => _resetNowForTests());

  it('PCS cycle outreach: live run and replay produce identical results', async () => {
    const log = new InMemoryEventLog();
    const ctx = {
      input: { has_orders: 'true', recently_quoted: 'false' },
      runId: 'replay_run_1',
    };

    const live = await run(PCS_CYCLE_OUTREACH, ctx, log);
    const stored = await log.read(workflowRunStream(PCS_CYCLE_OUTREACH.id, ctx.runId));
    const replayed = replay(PCS_CYCLE_OUTREACH, stored);

    expect(replayed).not.toBeNull();
    if (!replayed) return;

    // Same workflow + version + run id
    expect(replayed.workflowId).toBe(live.workflowId);
    expect(replayed.version).toBe(live.version);
    expect(replayed.runId).toBe(live.runId);

    // Same disposition
    expect(replayed.disposition).toBe(live.disposition);

    // Same step trace count + ordering + outcome
    expect(replayed.steps.length).toBe(live.steps.length);
    for (let i = 0; i < live.steps.length; i++) {
      const a = live.steps[i];
      const b = replayed.steps[i];
      expect(b.idx).toBe(a.idx);
      expect(b.kind).toBe(a.kind);
      expect(b.outcome).toBe(a.outcome);
      expect(b.label).toBe(a.label);
    }

    // Same event sequence (kind by kind)
    expect(replayed.events.map((e) => e.kind)).toEqual(live.events.map((e) => e.kind));
  });

  it('a filter-fail workflow is byte-identical on replay', async () => {
    const log = new InMemoryEventLog();
    const ctx = { input: {}, runId: 'replay_run_2' };

    const live = await run(PCS_CYCLE_OUTREACH, ctx, log);
    const replayed = replay(PCS_CYCLE_OUTREACH, await log.read(workflowRunStream(PCS_CYCLE_OUTREACH.id, ctx.runId)));

    expect(replayed?.disposition).toBe(live.disposition);
    expect(replayed?.steps.length).toBe(live.steps.length);
    expect(replayed?.steps[replayed.steps.length - 1].outcome).toBe('skip');
  });

  it('a workflow that pauses on `wait` replays into the same waiting state', async () => {
    const def: WorkflowDefinition = {
      id: 'wf-replay-wait', name: 'wait test', version: 1, description: '',
      retry: DEFAULT_RETRY,
      steps: [
        { kind: 'trigger', source: 'manual', label: 'go' },
        { kind: 'action', label: 'send email', verb: 'email', template: 't' },
        { kind: 'wait', label: 'wait 24h', durationMs: 24 * 60 * 60 * 1000 },
        { kind: 'end', label: 'done', disposition: 'queued' },
      ],
    };
    const log = new InMemoryEventLog();
    const ctx = { input: {}, runId: 'replay_run_3' };
    const live = await run(def, ctx, log);
    const replayed = replay(def, await log.read(workflowRunStream(def.id, ctx.runId)));
    expect(replayed?.disposition).toBe(live.disposition); // 'waiting'
    expect(replayed?.steps.length).toBe(live.steps.length);
  });

  it('replay returns null when there are no workflow events', () => {
    expect(replay(PCS_CYCLE_OUTREACH, [])).toBeNull();
  });
});
