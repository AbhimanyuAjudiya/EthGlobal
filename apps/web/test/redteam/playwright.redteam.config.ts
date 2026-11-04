import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * Red-team wave 3 (web) — security/redteam/attacks/wave3-web-ops.md W1–W11 plus the product probes of the
 * wave3-web brief. Runs against the SAME real local stack as the builder's suite (Anvil + services/api + a
 * production `next start` of apps/web): `security/redteam/run-wave.sh wave3-web` brings it up, or point
 * PLAYWRIGHT_BASE_URL / PLAYWRIGHT_API_URL at a running one. Green = the attack failed. Tests named
 * `…_RTFINDING` are confirmed findings (security/redteam/findings/RT-W-<nn>.md) and stay red until fixed.
 */
const repoRoot = path.join(import.meta.dirname, '../../../..');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: '.',
  testMatch: /rt-.*\.spec\.ts$/,
  outputDir: path.join(process.env.RT_OUT ?? path.join(repoRoot, '.e2e'), 'playwright-redteam'),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: '../../e2e/global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    headless: true,
    trace: 'off',
    serviceWorkers: 'block',
  },
});
