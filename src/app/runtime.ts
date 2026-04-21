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
import { WORKFLOWS, PCS_CYCLE_OUTREACH } from '../domain/workflow-def';
import { installVacuumRunner, type VacuumRunner } from '../domain/vacuum-runner';
import { recordVacuumOutcome } from '../domain/stats';
import { Outbox } from '../domain/outbox';
import { buildDispatcherRegistry } from '../domain/outbox-dispatchers';
import { runScenario, scenarioName, type ScenarioName } from '../seeds';
import { drainPersistedTelemetry } from './telemetry';

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

  await promiseStore.ready;
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
  await runScenario(eventLog, { promiseStore }, scenario, {
    runInvariants: false,
  });

  // Deal event-sourcing bootstrap. Seeds the static DEALS fixture into
  // the event log on first boot; no-op on subsequent boots. DealProjection
  // hydrates from the log after this lands.
  await bootstrapDealsIfEmpty(eventLog);
  await dealProjection.rehydrate();
  await signalProjection.ready;

  installPromiseTicker(promiseStore);
  registerSchedules();
  installOutboxDrainTriggers();

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
