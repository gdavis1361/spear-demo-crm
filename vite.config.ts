import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Default VITE_APP_VERSION so the `%VITE_APP_VERSION%` marker in
  // index.html always has a value — production deploys inject the commit
  // SHA from GitHub Actions; dev and local builds get 'dev'. Without this,
  // Vite warns on every HTML transform in dev.
  const env = loadEnv(mode, process.cwd(), '');
  if (!env.VITE_APP_VERSION) {
    process.env.VITE_APP_VERSION = 'dev';
  }
  return {
    plugins: [react()],
    server: { port: 5173 },
    build: {
      target: 'es2020',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Pin the seeds + Zod lazy chunk to a stable `schemas-*.js`
          // filename so `size-limit` thresholds stay meaningful across
          // refactors. Without this, Rollup sometimes names it
          // `index-*.js` when a new dynamic importer lands, which
          // collides with the entry chunk glob and inflates the
          // measured initial-bundle size.
          manualChunks(id) {
            if (id.includes('/src/seeds/') || id.includes('/node_modules/zod/')) {
              return 'schemas';
            }
            return undefined;
          },
        },
      },
    },
  };
});
