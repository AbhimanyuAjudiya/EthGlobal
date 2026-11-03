import { defineConfig } from 'vitest/config';

// The octroi brief (§7) sets the bar at 100 %: every money and replay branch is a tested branch.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
});
