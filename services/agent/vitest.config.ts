import { defineConfig } from 'vitest/config';

// agent.md §8: coverage ≥ 90 %. The CLI shim (src/index.ts) only calls main() and is covered by the build/start smoke run.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 90 },
    },
  },
});
