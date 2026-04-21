import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Strip woff (not woff2) face entries from `@fontsource/*` CSS before Vite
 * resolves the asset URLs. Every browser this app targets (es2020 baseline)
 * supports woff2; the woff fallbacks are legacy-Safari/IE11 artifacts that
 * @fontsource ships by default. Without this plugin, Vite copies all the
 * woff files into `dist/assets/` (~280 KB of deploy weight) even though no
 * browser ever fetches them because the woff2 line resolves first.
 *
 * The regex matches one `url(…) format('woff')` entry — optionally with a
 * preceding comma and whitespace — and removes it. Non-fontsource CSS is
 * unaffected because we gate on the module id.
 */
function stripWoffFallbacks(): Plugin {
  return {
    name: 'strip-woff-fallbacks',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
      const stripped = code.replace(
        /,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g,
        ''
      );
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

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
    plugins: [react(), stripWoffFallbacks()],
    server: { port: 5173 },
    build: {
      target: 'es2020',
      // `'hidden'` emits sourcemaps but omits the `//# sourceMappingURL=`
      // comment, so production artifacts don't reference them — browsers
      // never fetch them, casual viewers of DevTools don't see source.
      // Sentry and Datadog upload them via their build hooks regardless,
      // so crash reports stay symbolicated. Dev is unaffected (Vite dev
      // server builds fresh maps each request).
      sourcemap: 'hidden',
      rollupOptions: {
        output: {
          // Absorb shared chunks below ~10 KB into their importers rather
          // than emitting them separately. A 300-byte shared chunk (e.g.
          // one lucide icon used from two lazy screens) costs more in
          // HTTP overhead than a 300-byte duplication does in bandwidth.
          // Rollup will only collapse a chunk when duplication doesn't
          // inflate any *other* chunk past this threshold, so bigger
          // shared chunks (seeds registry, Zod, domain) stay split.
          experimentalMinChunkSize: 10_000,
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
