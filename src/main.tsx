import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { installMockApi } from './api/mock-server';
import { migrateLegacy } from './app/state';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/spear.css';
import './styles/crm.css';
import './styles/nouns.css';

migrateLegacy();
installMockApi();

import('./app/runtime').then(async ({ bootRuntime, startDemoWorkflowRunner }) => {
  await bootRuntime();
  startDemoWorkflowRunner();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
