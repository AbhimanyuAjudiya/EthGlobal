import { defineConfig } from 'vitest/config';

// Component tests run in jsdom; the Playwright print spec under tests/ runs with `pnpm test:print`.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tokens.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
