import { defineConfig, devices } from '@playwright/test';

/**
 * Two-project split:
 *   - `chromium-smoke`   — fast smoke + axe a11y (tests/smoke.spec.ts, tests/a11y.spec.ts)
 *   - `chromium-visual`  — pixel-diff snapshots of each screen (tests/visual/*.spec.ts)
 *
 * Visual is isolated because it demands stronger stabilization (fixed clock,
 * fixed viewport, reduced motion, font-load wait) and generates artifacts
 * (`tests/visual/**\/*-snapshots/`) that the smoke suite shouldn't touch.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-smoke',
      testMatch: ['smoke.spec.ts', 'a11y.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Cross-browser smoke: confirm the same flows work on Firefox + WebKit.
    // Visual regression stays Chromium-only (font rendering + AA differs
    // per engine; comparing across browsers is a different test).
    {
      name: 'firefox-smoke',
      testMatch: ['smoke.spec.ts'],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-smoke',
      testMatch: ['smoke.spec.ts'],
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'chromium-visual',
      testMatch: ['visual/*.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        // Respect prefers-reduced-motion so any CSS animations gated on it disable
        // themselves in screenshots.
        reducedMotion: 'reduce',
      },
      expect: {
        toHaveScreenshot: {
          // Light threshold — snapshots are on the same machine/browser, but fonts
          // can hint a pixel or two differently. 0.2% gives a comfortable margin.
          maxDiffPixelRatio: 0.002,
          animations: 'disabled',
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
