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
    // Some tests and hooks rebuild the whole demo warehouse: about 3 s on
    // Linux and 5-6 s on the author's Windows PC per rebuild (VERIFICATION.md).
    // 30 s leaves room for slower machines and still fails if one blocks.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
