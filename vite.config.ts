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
          // Name lazy chunks `lazy-*.js` instead of Rollup's default
          // `index-*.js`. Two motivations:
          //
          //   1. `size-limit`'s entry-chunk glob is `dist/assets/index-*.js`.
          //      When a new dynamic import lands whose name Rollup derives
          //      from an `index.ts` file (e.g. `import('./seeds')` picks
          //      up `src/seeds/index.ts`), the resulting chunk also gets
          //      named `index-*.js` and quietly double-counts into the
          //      entry-chunk budget.
          //   2. It keeps the dist/ listing scannable: entry vs. lazy is
          //      obvious from the filename without diffing hashes.
          //
          // Static `manualChunks` grouping was considered and rejected —
          // it forces Rollup to emit a sibling chunk for the entry when
          // any symbol (e.g. a Zod helper) is reachable from both the
          // entry and a lazy path, which adds a `<link rel="modulepreload">`
          // that eagerly loads the "lazy" chunk. That defeats PR #31's
          // whole-point lazy-seeds discipline.
          chunkFileNames(chunk) {
            const fromIndex = chunk.name === 'index';
            return fromIndex ? 'assets/lazy-[hash].js' : 'assets/[name]-[hash].js';
          },
        },
      },
    },
  };
});
