/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    /*
     * The Playwright suite is not Vitest's to run.
     *
     * Both use `describe`/`it`/`expect`, so Vitest happily collects
     * `e2e/*.spec.ts` and then fails on the import of `@playwright/test` --
     * a red suite that says nothing about the code. Playwright has its own
     * runner and its own config; this keeps the two from colliding.
     *
     * `include` covers src/ and the edge functions, whose validation and CORS
     * logic are unit-tested from here even though they ship to Deno.
     */
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'supabase/**/*.{test,spec}.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    /*
     * Vitest's default is 5s, which suits tests that call a function. A good
     * few here mount a full ProseMirror editor into jsdom, and one encodes a
     * buffer deliberately larger than the spread-argument limit.
     *
     * Those are fast alone -- the collab encoding file runs in about 600ms --
     * but the suite spins up a jsdom environment per file across 39 files, and
     * environment setup already costs more wall-clock than the assertions do.
     * Under that contention three of them crossed 5s and failed as timeouts,
     * on a machine with cores to spare; a two-core CI runner would be worse.
     *
     * Raised rather than papered over: each of those tests was checked to be
     * slow, not hung. If something genuinely deadlocks, 15s still catches it
     * without turning a hang into a twenty-minute CI job.
     */
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
