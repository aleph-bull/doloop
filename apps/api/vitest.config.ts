import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // PGlite boots an in-process Postgres per file; give it room on slow machines.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
