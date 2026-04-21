import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { installMockApi } from './api/mock-server';
import { migrateLegacy } from './app/state';
import { initObservability } from './app/observability';
import { track } from './app/telemetry';
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

// Wrap each boot stage so a failure in one emits a structured
// `app.boot_failed` event instead of a silent blank page.
try {
  migrateLegacy();
} catch (err) {
  track({
    name: 'app.boot_failed',
    props: { stage: 'migrate_legacy', message: (err as Error).message },
  });
  throw err;
}

try {
  installMockApi();
} catch (err) {
  track({
    name: 'app.boot_failed',
    props: { stage: 'install_mock', message: (err as Error).message },
  });
  throw err;
}

import('./app/runtime').then(async ({ bootRuntime, startDemoWorkflowRunner }) => {
  try {
    await bootRuntime();
  } catch (err) {
    track({
      name: 'app.boot_failed',
      props: { stage: 'runtime', message: (err as Error).message },
    });
    throw err;
  }
  try {
    startDemoWorkflowRunner();
  } catch (err) {
    track({
      name: 'app.boot_failed',
      props: { stage: 'workflow_runner', message: (err as Error).message },
    });
    throw err;
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
