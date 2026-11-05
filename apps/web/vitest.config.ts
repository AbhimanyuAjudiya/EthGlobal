import { defineConfig } from 'vitest/config';

// Units run in node; component tests opt into jsdom with a `@vitest-environment jsdom` docblock.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
  },
});
