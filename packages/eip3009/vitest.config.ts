import { defineConfig } from 'vitest/config';

// Coverage gate (BUILD-PLAN §W1a): `pnpm --filter <pkg> exec vitest run --coverage`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
