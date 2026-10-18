import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // Applies migrations to the test database before any test file runs.
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // The API tests share one database, so test files run one at a time.
    fileParallelism: false,
    // Some tests rebuild the whole demo warehouse (a few seconds each).
    testTimeout: 30_000,
  },
});
