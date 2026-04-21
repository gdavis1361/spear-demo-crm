import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: ['src/test/setup-idb.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Primitives + domain are the contract — cover them at a high bar.
      // API client + app state are tested via integration (MSW + Playwright).
      include: ['src/lib/**/*.ts', 'src/domain/**/*.ts'],
      exclude: [
        'src/lib/**/*.test.ts',
        'src/lib/types.ts',
        'src/lib/data.tsx',
        'src/domain/**/*.test.ts',
      ],
      thresholds: {
        // Browser-runtime bits (IndexedDbEventLog at events.ts:240+, the
        // promise ticker installer, BroadcastChannel paths) are exercised
        // by Playwright, not Vitest. The deterministic core stays well
        // above 90%; thresholds are tuned for the merged surface.
        perFile: false,
        lines: 75,
        functions: 65,
        branches: 60,
        statements: 75,
      },
    },
  },
});
