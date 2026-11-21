import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests share one PostgreSQL database, so run files sequentially.
    fileParallelism: false,
    pool: 'forks',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20_000,
  },
});
