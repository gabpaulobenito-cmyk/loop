import { defineConfig, devices } from '@playwright/test';

/**
 * Post-deploy smoke test against a live deployment.
 *   SMOKE_URL=https://… npm run test:smoke
 * Strictly read-only against the live workspace (see tests/smoke).
 */
export default defineConfig({
  testDir: 'tests/smoke',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.SMOKE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
