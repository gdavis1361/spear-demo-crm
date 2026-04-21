// Runtime — long-lived singletons for the durable layer.
//
// `main.tsx` calls `bootRuntime()` exactly once before render. Components
// import the singletons (`promiseStore`, `scheduleRegistry`, `eventLog`,
// `runHistory`) directly. No prop-drilling, no context for these — they
// outlive React.

import { eventLog, reportStorageEstimate } from '../domain/events';
import { PromiseStore, installPromiseTicker } from '../domain/promises';
import { ScheduleRegistry } from '../domain/schedules';
import { DealProjection } from '../domain/deal-projection';
import { SignalProjection } from '../domain/signal-projection';
import { bootstrapDealsIfEmpty } from '../domain/deal-bootstrap';
import { run as runWorkflow, type RunResult } from '../domain/workflow-runner';
import { DEFAULT_ACTIVITIES } from '../domain/workflow-activities';
import { WORKFLOWS, PCS_CYCLE_OUTREACH } from '../domain/workflow-def';
import { installVacuumRunner, type VacuumRunner } from '../domain/vacuum-runner';
import { recordVacuumOutcome } from '../domain/stats';
import { Outbox } from '../domain/outbox';
import { buildDispatcherRegistry } from '../domain/outbox-dispatchers';
import { runScenario, scenarioName, type ScenarioName } from '../seeds';
import { drainPersistedTelemetry, _setLastOutboxDepth, track } from './telemetry';
import { startSpan } from './observability';

export const promiseStore = new PromiseStore(eventLog);
export const scheduleRegistry = new ScheduleRegistry(eventLog);
export const dealProjection = new DealProjection(eventLog);
/**
 * Signal dismiss/action state as a first-class durable projection (VX1).
 * The Signals feed itself stays a static fixture; this projection folds
 * user-mark events (`signal.dismissed` / `signal.actioned` + their
 * reverts) on top so a dismissed signal stays hidden across navigation,
 * reload, and the outbox's permanent-failure compensation.
 */
export const signalProjection = new SignalProjection(eventLog);
/**
 * Durable outbox: the only path from an optimistic UI write to the
 * server. Components enqueue mutations against this singleton; the
 * drainer (see bootRuntime below) owns retry + permanent-failure
 * compensation. R1 of the Linear runtime audit.
 */
export const outbox = new Outbox(buildDispatcherRegistry(eventLog));
export let vacuumRunner: VacuumRunner | null = null;

// Recent workflow runs, kept in memory so the Workflows tab can render.
class RunHistory {
  private byWorkflow = new Map<string, RunResult[]>();
  private subs = new Set<(snap: ReadonlyMap<string, readonly RunResult[]>) => void>();

  push(result: RunResult): void {
    const prev = this.byWorkflow.get(result.workflowId) ?? [];
    const next = [result, ...prev].slice(0, 25);
    this.byWorkflow.set(result.workflowId, next);
    this.emit();
  }
  recent(workflowId: string, n = 5): readonly RunResult[] {
    return (this.byWorkflow.get(workflowId) ?? []).slice(0, n);
  }
  subscribe(fn: (snap: ReadonlyMap<string, readonly RunResult[]>) => void): () => void {
    this.subs.add(fn);
    fn(this.byWorkflow);
    return () => {
      this.subs.delete(fn);
    };
  }
  private emit(): void {
    for (const s of this.subs) s(this.byWorkflow);
  }
}

export const runHistory = new RunHistory();

// ─── Boot ──────────────────────────────────────────────────────────────────

let booted = false;

/**
 * Boot the runtime in lifecycle order:
 *   1. Wait for PromiseStore IDB hydration.
 *   2. Seed demo fixtures if the store is empty.
 *   3. Install the promise ticker (fires immediately).
 *   4. Register polling schedules.
 *   5. Install the vacuum runner (idle-time, hourly cadence).
 */
export interface BootOptions {
  /** Scenario to seed at boot. Default: 'canonical' (user's real DB). */
  readonly scenario?: ScenarioName;
}

export async function bootRuntime(opts: BootOptions = {}): Promise<void> {
  if (booted || typeof window === 'undefined') return;
  booted = true;

  const bootStart = performance.now();

  // H7: per-stage timing. Each stage wraps in startSpan (H5 — no-op when
  // Sentry is off) and emits `app.boot_stage_completed` with its duration,
  // so a slow boot can be partitioned between "PromiseStore hydrate" vs
  // "seed runner" vs "projection rehydrate". These are historically the
  // three axes that cause user-perceptible boot slowness; before H7 we
  // only had the outer app.mounted event, which bundled all of them.
  type BootStageName =
    | 'promise_store_ready'
    | 'seed_scenario'
    | 'deal_bootstrap'
    | 'projection_rehydrate';

  const runStage = async <T>(stage: BootStageName, fn: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    const out = (await startSpan({ name: `boot.${stage}`, op: 'boot.stage' }, fn)) as T;
    track({
      name: 'app.boot_stage_completed',
      props: { stage, ms: Math.round(performance.now() - t0) },
    });
    return out;
  };

  await runStage('promise_store_ready', () => promiseStore.ready);

  // Seed scenario. `runInvariants: false` because a user's local state may
  // have drifted (old build, deleted promise, vacuum) — in that case the
  // scenario's build short-circuits but the invariant would still throw
  // and take down bootRuntime. Invariants are a test/CLI concern, not a
  // boot-time concern.
  //
  // Seed scenarios (`?seed=<name>`) open their own IndexedDB via
  // `setDbName()` before this module loads, so the eventLog + promiseStore
  // seen here are already bound to the isolated DB.
  const scenario = opts.scenario ?? scenarioName('canonical');
  await runStage('seed_scenario', () =>
    runScenario(eventLog, { promiseStore }, scenario, {
      runInvariants: false,
    })
  );

  // Deal event-sourcing bootstrap. Seeds the static DEALS fixture into
  // the event log on first boot; no-op on subsequent boots. DealProjection
  // hydrates from the log after this lands.
  await runStage('deal_bootstrap', () => bootstrapDealsIfEmpty(eventLog));
  await runStage('projection_rehydrate', async () => {
    await dealProjection.rehydrate();
    await signalProjection.ready;
  });

  installPromiseTicker(promiseStore);
  registerSchedules();
  installOutboxDrainTriggers();

  // Publish outbox depth into the ambient module so every telemetry
  // envelope can carry `outboxDepth` via `baseContext()` (H2). Inverted
  // dependency — telemetry exposes a setter, outbox is the source, the
  // ambient mirror lives in `src/app/ambient.ts`. This keeps the durable
  // layer out of the entry chunk.
  //
  // H4 piggy-backs on the same subscription: every snapshot change
  // recomputes the (pending, permanent, oldest-age) triple and, if it
  // *transitioned* across the health boundary (idle ↔ syncing ↔
  // degraded), emits an `outbox.queue_status` event. A periodic 30s
  // ticker re-emits while non-idle so a queue that sits at degraded for
  // hours still shows up as an ongoing signal in Honeycomb — the SLO
  // burn-rate rule is "any degraded event in the last window," so
  // silence means green.
  installOutboxQueueStatusTelemetry();

  // Vacuum runner pipes its outcome into stats so the debug pane has
  // "last vacuum" without coupling vacuum-runner to stats directly.
  vacuumRunner = installVacuumRunner(eventLog);
  // Trigger a first pass on idle-ish so the demo has a recent run on hand.
  void vacuumRunner.runNow().then((r) => recordVacuumOutcome(r.finishedAt, r.totalDeleted));

  // Fire-and-forget quota check. Emits `storage.quota_near` at ≥80% so
  // operators see pressure before a write hits `quota_exceeded`.
  void reportStorageEstimate();

  // Boot-time drain: catch anything left over from the previous tab's
  // crash/close. `await` is fine — outbox pre-flights `navigator.onLine`
  // so it resolves quickly when offline. If the current tab is online but
  // mutations fail, they stay durable and the periodic trigger tries
  // again.
  void outbox.drain();

  // VX10: re-submit any telemetry batches a prior session persisted
  // after a failed POST. Fire-and-forget — failures bump attemptCount
  // durably without blocking boot.
  void drainPersistedTelemetry();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void drainPersistedTelemetry());
  }

  // H7: ship one `app.ready` event that carries both the total boot
  // duration (measured here) and the first-paint duration (read from
  // the Performance API). `totalMs` is the time-to-interactive SLI
  // target — see docs/ops/slo.md. `firstPaintMs` is the independent
  // browser signal we use when boot time balloons but TTI doesn't, so
  // we can separate "expensive runtime" from "expensive paint".
  let firstPaintMs = 0;
  if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
    const paints = performance.getEntriesByType('paint');
    const fp = paints.find((p) => p.name === 'first-paint' || p.name === 'first-contentful-paint');
    if (fp) firstPaintMs = Math.round(fp.startTime);
  }
  track({
    name: 'app.ready',
    props: {
      totalMs: Math.round(performance.now() - bootStart),
      firstPaintMs,
      scenario: opts.scenario ?? null,
    },
  });
}

// ─── Fixtures ──────────────────────────────────────────────────────────────
// The former `seedFixturesIfEmpty()` is now the `canonical` scenario in
// `src/seeds/scenarios/canonical.ts`. `bootRuntime()` runs it via the
// runner, which emits `seed.started` / `seed.completed` telemetry + is
// testable + composable with future layered scenarios.

// ─── Schedules ─────────────────────────────────────────────────────────────
// Three live polls register here. The Signals page reads them.

function registerSchedules(): void {
  scheduleRegistry.register({
    name: 'milmove.cycle',
    intervalMs: 60_000, // demo cadence
    jitterMs: 5_000,
    retry: {
      maxAttempts: 3,
      initialBackoffMs: 1000,
      backoffMultiplier: 2,
      nonRetryable: ['permission_denied'],
    },
    run: async (runId, _at) => {
      // Stand-in: real impl polls /milmove/cycles. We pretend to find 0–4 items.
      const items = Math.floor(Math.random() * 5);
      return { runId, items };
    },
  });
  scheduleRegistry.register({
    name: 'sam.gov.rfp',
    intervalMs: 120_000,
    jitterMs: 10_000,
    retry: { maxAttempts: 3, initialBackoffMs: 1500, backoffMultiplier: 2, nonRetryable: [] },
    run: async (runId, _at) => {
      const items = Math.floor(Math.random() * 3);
      return { runId, items };
    },
  });
  scheduleRegistry.register({
    name: 'facebook.spouses',
    intervalMs: 90_000,
    jitterMs: 8_000,
    retry: { maxAttempts: 2, initialBackoffMs: 2000, backoffMultiplier: 2, nonRetryable: [] },
    run: async (runId, _at) => {
      const items = Math.floor(Math.random() * 2);
      return { runId, items };
    },
  });
}

// ─── Outbox drainers ───────────────────────────────────────────────────────
//
// Four triggers, matching the "when is it worth trying again?" question:
//   1. Boot            — catch mutations left over from a prior crash.
//   2. `online`        — network came back; drain ASAP, don't wait for timer.
//   3. `visibilitychange` to visible — tab came back to foreground; likely
//      user about to interact, catch any pending state fast so the next UI
//      re-render reflects truth.
//   4. Periodic (30s)  — the catch-all for slow degradations; also what
//      runs when a tab stays online and foregrounded for a long time.
//
// All four end up calling `outbox.drain()`, which holds a cross-tab lock
// (via navigator.locks), so redundant triggers across tabs don't
// double-send.

let outboxTriggersInstalled = false;
function installOutboxDrainTriggers(): void {
  if (outboxTriggersInstalled || typeof window === 'undefined') return;
  outboxTriggersInstalled = true;

  window.addEventListener('online', () => void outbox.drain());
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void outbox.drain();
  });

  // Periodic sweep under the existing ScheduleRegistry so the outbox gets
  // the same retry policy + jitter + telemetry discipline as the inbound
  // polls. 30s cadence is tight enough that a user reopening a tab after
  // a sync failure sees fresh state; loose enough that we don't burn
  // quota on a healthy queue.
  scheduleRegistry.register({
    name: 'outbox.drain',
    intervalMs: 30_000,
    jitterMs: 3_000,
    retry: { maxAttempts: 1, initialBackoffMs: 1000, backoffMultiplier: 2, nonRetryable: [] },
    run: async (runId, _at) => {
      const report = await outbox.drain();
      return { runId, items: report.attempted };
    },
  });
}

// ─── Outbox queue-status telemetry (H4) ────────────────────────────────────
//
// Two firing rules:
//   1. *Transition* — the derived `status` (idle / syncing / degraded)
//      crossed a boundary. Fires once per change. This is the signal an
//      alert fires on (degraded-first, not every sample).
//   2. *Periodic keepalive* — every 30s while non-idle. Honeycomb prefers
//      wide events over time-series counters; the keepalive emits one
//      event per window so a 20-minute-long degradation has 40 samples
//      of shape and depth, not a single edge.
//
// Skipped when the browser is offline — we can't distinguish "sync stuck
// on wire failure" from "user is on a plane" via the queue alone, and
// `navigator.onLine === false` is the authoritative source for the
// distinction. An `online` event will re-kick the drainer, which will
// naturally re-evaluate status through this same subscriber.

const QUEUE_STATUS_KEEPALIVE_MS = 30_000;
const QUEUE_STATUS_DEGRADED_MS = 60_000;

type QueueStatusComputed = {
  readonly pending: number;
  readonly permanent: number;
  readonly oldestPendingAgeMs: number;
  readonly status: 'idle' | 'syncing' | 'degraded';
};

function computeQueueStatus(
  rows: ReadonlyArray<{ status: string; createdAt: string }>,
  now: number
): QueueStatusComputed {
  let pending = 0;
  let permanent = 0;
  let oldest = 0;
  for (const r of rows) {
    if (r.status === 'pending' || r.status === 'in_flight') {
      pending++;
      const age = now - new Date(r.createdAt).getTime();
      if (age > oldest) oldest = age;
    } else if (r.status === 'permanent_failure') {
      permanent++;
    }
  }
  const status: QueueStatusComputed['status'] =
    permanent > 0 || (pending > 0 && oldest > QUEUE_STATUS_DEGRADED_MS)
      ? 'degraded'
      : pending > 0
        ? 'syncing'
        : 'idle';
  return { pending, permanent, oldestPendingAgeMs: oldest, status };
}

function installOutboxQueueStatusTelemetry(): void {
  let lastStatus: QueueStatusComputed['status'] | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const emit = (snap: QueueStatusComputed, reason: 'transition' | 'periodic'): void => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    track({
      name: 'outbox.queue_status',
      props: {
        pending: snap.pending,
        permanent: snap.permanent,
        oldestPendingAgeMs: snap.oldestPendingAgeMs,
        status: snap.status,
        reason,
      },
    });
  };

  outbox.subscribe((rows) => {
    const depth = rows.filter((r) => r.status === 'pending' || r.status === 'in_flight').length;
    _setLastOutboxDepth(depth);
    const snap = computeQueueStatus(rows, Date.now());
    if (lastStatus !== snap.status) {
      // Suppress the "null → idle" startup edge so an idle session
      // emits zero queue_status events (advisor feedback). The first
      // real transition is `idle → syncing` when a user action lands a
      // mutation in the outbox, which is what we want dashboards keyed
      // on. Non-idle boots (prior session left rows behind) still fire
      // immediately because the initial snapshot is syncing/degraded.
      const suppressInitial = lastStatus === null && snap.status === 'idle';
      if (!suppressInitial) emit(snap, 'transition');
      lastStatus = snap.status;
    }
    // Keepalive only runs while non-idle; arm/disarm as we transition
    // into/out of idle so a healthy queue never touches the timer loop.
    if (snap.status !== 'idle' && !keepaliveTimer) {
      keepaliveTimer = setInterval(() => {
        void outbox.all().then((all) => {
          const latest = computeQueueStatus(all, Date.now());
          if (latest.status === 'idle') {
            if (keepaliveTimer) {
              clearInterval(keepaliveTimer);
              keepaliveTimer = null;
            }
            return;
          }
          emit(latest, 'periodic');
        });
      }, QUEUE_STATUS_KEEPALIVE_MS);
    } else if (snap.status === 'idle' && keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  });
}

export const _computeQueueStatusForTests = computeQueueStatus;

// ─── Demo: kick a workflow run on boot so the Workflows tab has something ──
//
// Real app: triggered by inbound webhook / signal. Demo: fire one
// PCS-cycle outreach against synthetic input every 30s.

let demoTimer: ReturnType<typeof setInterval> | null = null;

export function startDemoWorkflowRunner(): () => void {
  if (demoTimer || typeof window === 'undefined') return () => undefined;
  const fire = async () => {
    const ctx = {
      input: { has_orders: 'true', recently_quoted: 'false' },
      runId: `run_${Date.now().toString(36)}`,
      // T3: pass the default activity registry so action steps emit
      // `workflow.activity_dispatched` events per (runId, stepIdx).
      // Absent the registry, action steps fall through as no-ops —
      // useful for tests, not for production telemetry.
      activities: DEFAULT_ACTIVITIES,
    };
    const result = await runWorkflow(PCS_CYCLE_OUTREACH, ctx, eventLog);
    runHistory.push(result);
  };
  void fire();
  demoTimer = setInterval(() => void fire(), 30_000);
  return () => {
    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
  };
}

export { WORKFLOWS };
