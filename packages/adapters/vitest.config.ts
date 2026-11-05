import { defineConfig } from 'vitest/config';

// Coverage gate (BUILD-PLAN §W1a): `pnpm --filter @ethglobal/adapters exec vitest run --coverage`.
// test/integration needs ANVIL_RPC_URL (scripts/dev-chain.sh) and is skipped without it.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
