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
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'supabase/functions/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
