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
import { bootstrapDealsIfEmpty } from '../domain/deal-bootstrap';
import { run as runWorkflow, type RunResult } from '../domain/workflow-runner';
import { WORKFLOWS, PCS_CYCLE_OUTREACH } from '../domain/workflow-def';
import { installVacuumRunner, type VacuumRunner } from '../domain/vacuum-runner';
import { recordVacuumOutcome } from '../domain/stats';
import { runScenario, scenarioName } from '../seeds';

export const promiseStore = new PromiseStore(eventLog);
export const scheduleRegistry = new ScheduleRegistry(eventLog);
export const dealProjection = new DealProjection(eventLog);
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
export async function bootRuntime(): Promise<void> {
  if (booted || typeof window === 'undefined') return;
  booted = true;

  await promiseStore.ready;
  // Canonical seed. `runInvariants: false` because a user's local state may
  // have drifted (old build, deleted promise, vacuum) — in that case the
  // scenario's build short-circuits but the invariant would still throw
  // and take down bootRuntime. Invariants are a test/CLI concern, not a
  // boot-time concern.
  await runScenario(eventLog, { promiseStore }, scenarioName('canonical'), {
    runInvariants: false,
  });

  // Deal event-sourcing bootstrap. Seeds the static DEALS fixture into
  // the event log on first boot; no-op on subsequent boots. DealProjection
  // hydrates from the log after this lands.
  await bootstrapDealsIfEmpty(eventLog);
  await dealProjection.rehydrate();

  installPromiseTicker(promiseStore);
  registerSchedules();

  // Vacuum runner pipes its outcome into stats so the debug pane has
  // "last vacuum" without coupling vacuum-runner to stats directly.
  vacuumRunner = installVacuumRunner(eventLog);
  // Trigger a first pass on idle-ish so the demo has a recent run on hand.
  void vacuumRunner.runNow().then((r) => recordVacuumOutcome(r.finishedAt, r.totalDeleted));

  // Fire-and-forget quota check. Emits `storage.quota_near` at ≥80% so
  // operators see pressure before a write hits `quota_exceeded`.
  void reportStorageEstimate();
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
