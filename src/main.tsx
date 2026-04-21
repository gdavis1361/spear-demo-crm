import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { installMockApi } from './api/mock-server';
import { migrateLegacy } from './app/state';
import { initObservability } from './app/observability';
import { track, flush as flushTelemetry } from './app/telemetry';
import { setSeed as setAmbientSeed } from './app/ambient';
// Seed activation must import before anything pulls in `./app/runtime`
// (which would import domain/events and potentially realize the IDB
// connection). Imported from `./seeds/activation` directly — NOT from
// `./seeds` — so the scenario registry + builders + Zod schemas stay in
// their lazy chunk rather than landing in the initial bundle.
// `activateSeedFromUrl()` is a no-op when `?seed=` is absent.
import { activateSeedFromUrl, consumePendingReset } from './seeds/activation';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/spear.css';
import './styles/crm.css';
import './styles/nouns.css';

// Observability first: captures any exception thrown during the boot sequence.
// Fire-and-forget — `initObservability` is async now (Sentry is dynamic-
// imported only when a DSN is configured), but we don't block render on it.
// web-vitals registers synchronously inside initObservability so LCP/FCP
// hooks are in place before the first paint anyway.
void initObservability();

// Wrap each boot stage so a failure in one emits a structured
// `app.boot_failed` event instead of a silent blank page. We `flushTelemetry`
// synchronously (via sendBeacon) before re-throwing so the event ships even
// when the user parks on the error screen — otherwise the 2s flush timer
// never fires and the SLO numerator is biased toward looking healthier
// than it is.
type BootStage = 'migrate_legacy' | 'install_mock' | 'runtime' | 'workflow_runner';
function bootFailed(stage: BootStage, err: unknown): never {
  track({ name: 'app.boot_failed', props: { stage, message: (err as Error).message } });
  flushTelemetry(true);
  throw err;
}

// H7: wrap each outer boot stage in a timing band so a slow boot can be
// partitioned (migrate-legacy vs install-mock vs runtime vs workflow-
// runner). The inner `runtime` stage further decomposes into four
// finer-grained stages — see bootRuntime in runtime.ts.
function stamp<T>(
  stage: 'migrate_legacy' | 'install_mock' | 'seed_activation' | 'runtime' | 'workflow_runner',
  fn: () => T
): T {
  const t0 = performance.now();
  const out = fn();
  track({
    name: 'app.boot_stage_completed',
    props: { stage, ms: Math.round(performance.now() - t0) },
  });
  return out;
}

async function stampAsync<T>(
  stage: 'runtime' | 'workflow_runner',
  fn: () => Promise<T>
): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  track({
    name: 'app.boot_stage_completed',
    props: { stage, ms: Math.round(performance.now() - t0) },
  });
  return out;
}

try {
  stamp('migrate_legacy', migrateLegacy);
} catch (err) {
  bootFailed('migrate_legacy', err);
}

try {
  stamp('install_mock', installMockApi);
} catch (err) {
  bootFailed('install_mock', err);
}

// Strict ordering:
//   1. consumePendingReset  — delete any DB armed by the banner's Reset
//                             (safe only while no IndexedDB connection is
//                             open, which is why it runs before step 2).
//   2. activateSeedFromUrl  — calls setDbName() for the scenario's DB.
//                             Must land before step 3, or PromiseStore
//                             construction inside runtime.ts will lock
//                             the DB name to its default ('spear-events').
//   3. import('./app/runtime') — opens the DB (now under the chosen name),
//                                hydrates stores, runs the scenario.
//   4. bootRuntime(scenario) — orchestrates seeding + ticker + schedules.
//
// `.then()` chaining keeps the bundle on ES2020 without top-level await.
consumePendingReset()
  .then(() => activateSeedFromUrl())
  .then(async (activation) => {
    setAmbientSeed(activation.scenario);
    const { bootRuntime, startDemoWorkflowRunner } = await import('./app/runtime');
    try {
      // When a seed is active, boot against that scenario instead of
      // `canonical`. When activation.scenario is null, bootRuntime falls
      // back to canonical — byte-identical to pre-Phase-3 behavior.
      await stampAsync('runtime', () =>
        bootRuntime(activation.scenario ? { scenario: activation.scenario } : {})
      );
    } catch (err) {
      bootFailed('runtime', err);
    }
    try {
      // `startDemoWorkflowRunner` is synchronous; the async wrapper
      // keeps the stamp shape consistent with the `runtime` stage and
      // costs nothing since the wrapper awaits a trivially-resolved
      // return.
      await stampAsync('workflow_runner', async () => startDemoWorkflowRunner());
    } catch (err) {
      bootFailed('workflow_runner', err);
    }
  });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
