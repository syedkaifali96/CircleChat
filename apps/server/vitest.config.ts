import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    // Embedded PostgreSQL init + real migration application take a while once.
    hookTimeout: 300_000,
  },
});
