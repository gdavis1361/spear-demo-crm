import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { installMockApi } from './api/mock-server';
import { migrateLegacy } from './app/state';
import { initObservability } from './app/observability';
import { track, flush as flushTelemetry } from './app/telemetry';
// Seed activation must import before anything pulls in `./app/runtime`
// (which would import domain/events and potentially realize the IDB
// connection). Imported from `./seeds/activation` directly — NOT from
// `./seeds` — so the scenario registry + builders + Zod schemas stay in
// their lazy chunk rather than landing in the initial bundle.
// `activateSeedFromUrl()` is a no-op when `?seed=` is absent.
import { activateSeedFromUrl } from './seeds/activation';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/spear.css';
import './styles/crm.css';
import './styles/nouns.css';

// Observability first: captures any exception thrown during the boot sequence.
initObservability();

// Detect `?seed=<name>` and, if it resolves to a registered scenario, swap
// the IndexedDB name BEFORE runtime.ts is dynamically imported below. The
// user's real DB (`spear-events`) is only opened when `?seed` is absent
// or invalid.
const seedActivation = activateSeedFromUrl();

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

try {
  migrateLegacy();
} catch (err) {
  bootFailed('migrate_legacy', err);
}

try {
  installMockApi();
} catch (err) {
  bootFailed('install_mock', err);
}

import('./app/runtime').then(async ({ bootRuntime, startDemoWorkflowRunner }) => {
  try {
    // When a seed is active, boot against that scenario instead of the
    // default `canonical`. When `seedActivation.scenario` is null,
    // bootRuntime falls back to canonical — byte-identical to the
    // pre-Phase-3 behavior.
    await bootRuntime(seedActivation.scenario ? { scenario: seedActivation.scenario } : {});
  } catch (err) {
    bootFailed('runtime', err);
  }
  try {
    startDemoWorkflowRunner();
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
