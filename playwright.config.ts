import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests.
 *
 * These exist for the things jsdom cannot answer. The unit suite covers the
 * document model, the services and the pure helpers well; what it cannot see
 * is layout, caret position, print output, and whether a Content-Security-
 * Policy actually permits what the app does. Every test here should be one
 * that genuinely needs a browser -- anything else belongs in Vitest, which is
 * two orders of magnitude faster.
 *
 * Runs against a production build rather than the dev server: the CSP, the
 * bundled CSS and the real asset paths are part of what is being checked, and
 * none of them are what `vite dev` serves.
 */
export default defineConfig({
  testDir: './e2e',
  // Guest mode needs no backend, and every spec here works signed out on
  // purpose: an E2E suite that needs live credentials is one nobody runs.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    // `vite preview` serves the build. Bound to 127.0.0.1 rather than
    // localhost so it cannot resolve to an IPv6 address the tests then fail to
    // reach on Windows.
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
