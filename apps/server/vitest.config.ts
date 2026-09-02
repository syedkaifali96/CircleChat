import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    // Embedded PostgreSQL init + real migration application take a while once.
    hookTimeout: 300_000,
    // Database integration files each manage their own PostgreSQL instance;
    // run test files sequentially to avoid resource contention.
    fileParallelism: false,
  },
});
