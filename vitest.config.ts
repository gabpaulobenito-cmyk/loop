import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // Integration suites share one test database; run files sequentially.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
