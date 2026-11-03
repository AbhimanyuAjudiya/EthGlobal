import { defineConfig } from 'vitest/config';

// Coverage gate (BUILD-PLAN §W1a); stricter than elsewhere because this is the one cryptography owner.
export default defineConfig({
  test: {
    coverage: { provider: 'v8', include: ['src/**'], thresholds: { 100: true } },
  },
});
