import { defineConfig, devices } from '@playwright/test';

/**
 * Post-deploy smoke test against a live deployment.
 *   SMOKE_URL=https://… npm run test:smoke
 * It creates uniquely tagged loops, verifies the full lifecycle and layouts,
 * then undoes its own actions.
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
