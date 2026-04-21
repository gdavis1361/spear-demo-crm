// Default activity registry (T3).
//
// One stub per `ActionVerb`. Each activity emits a
// `workflow.activity_dispatched` telemetry event so dashboards can
// observe per-verb volume + tail latency without replaying the event
// log. Activities deliberately do NOT touch the outbox here — outbox
// mutations are a separate concern (advance_deal / dismiss_signal /
// action_signal) and tying them to the workflow runtime would knot
// two independently-tested subsystems. When a real email send or
// task creation lands, the activity for that verb can enqueue an
// outbox row with the supplied `actCtx.opKey` as the idempotency
// key — same contract the outbox already enforces for deal moves.
//
// Why stubs and not no-ops: a no-op doesn't tell operators whether a
// workflow's third step ran. The telemetry event is the observable
// footprint that proves it did — and it's deterministic per
// `(runId, stepIdx)` because the runner threads a stable opKey
// through `actCtx`, which we surface to telemetry so retries can be
// correlated without hand-tracing event logs.

import { track } from '../app/telemetry';
import type { ActivityFn, ActivityRegistry } from './workflow-runner';

function mkActivity(verb: string): ActivityFn {
  return async (step, runCtx, actCtx) => {
    track({
      name: 'workflow.activity_dispatched',
      props: {
        workflowId: actCtx.workflowId,
        runId: actCtx.runId,
        stepIdx: actCtx.stepIdx,
        attempt: actCtx.attempt,
        verb,
        template: step.template,
        opKey: actCtx.opKey,
      },
    });
    void runCtx;
  };
}

/**
 * The set bootRuntime passes into every run. A test can spread over
 * individual verbs to inject failures without rebuilding the whole map.
 */
export const DEFAULT_ACTIVITIES: ActivityRegistry = {
  email: mkActivity('email'),
  create_task: mkActivity('create_task'),
  assign_dispatcher: mkActivity('assign_dispatcher'),
  add_to_today: mkActivity('add_to_today'),
  notify_manager: mkActivity('notify_manager'),
};
