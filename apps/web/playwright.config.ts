import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';


/**
 * Playwright in MODE=local against the REAL stack: Anvil + Deploy.s.sol + services/api (self-run facilitator,
 * real EIP-3009 settlement) + this app's production build. `scripts/e2e-local.sh --web` brings up chain and API
 * and exports PLAYWRIGHT_API_URL / RPC_URL; the web server below (e2e/serve.sh) builds the app against those
 * URLs and serves it. PLAYWRIGHT_BASE_URL points at an already-running web app instead.
 */
// e2e/env.ts carries the same defaults for the (ESM) specs; this file is loaded as CommonJS
const repoRoot = path.join(__dirname, '../..');
const external = process.env.PLAYWRIGHT_BASE_URL;
const WEB_PORT = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3000);
const BASE_URL = external ?? `http://127.0.0.1:${WEB_PORT}`;
const webEnv = {
  PORT: String(WEB_PORT),
  PLAYWRIGHT_API_URL: process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8788',
  PLAYWRIGHT_RPC_URL: process.env.PLAYWRIGHT_RPC_URL ?? process.env.RPC_URL ?? 'http://127.0.0.1:8546',
  PRINT_TOKEN: process.env.PRINT_TOKEN ?? 'local-e2e-print-token-0001',
  PRINT_CARDS_FILE: process.env.PRINT_CARDS_FILE ?? path.join(repoRoot, '.e2e', 'web-print-cards.json'),
};

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  outputDir: path.join(repoRoot, '.e2e', 'playwright'),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // one chain, one demo wallet per role: transactions from the same account must not race for nonces
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    headless: true,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'web', testIgnore: /zz-clock\.spec\.ts/ },
    // moves the API's local clock and Anvil's time forward: runs last, after everything else
    { name: 'clock', testMatch: /zz-clock\.spec\.ts/, dependencies: ['web'] },
  ],
  ...(external
    ? {}
    : {
        webServer: {
          command: 'bash e2e/serve.sh',
          url: `${BASE_URL}/offline`,
          reuseExistingServer: true,
          timeout: 300_000,
          stdout: 'pipe',
          env: webEnv,
        },
      }),
});
