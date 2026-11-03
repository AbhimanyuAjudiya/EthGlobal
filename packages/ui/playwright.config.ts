import { defineConfig, devices } from '@playwright/test';

/**
 * `pnpm --filter @ethglobal/ui test:print` — renders /ui/print to PDF in headless Chromium.
 * Build the web app first (`pnpm --filter web build`); the web server below starts it on :3107, or point
 * PLAYWRIGHT_BASE_URL at a running instance.
 */
const port = 3107;
const external = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: external ?? `http://localhost:${port}`,
    headless: true,
  },
  ...(external
    ? {}
    : {
        webServer: {
          command: `pnpm --dir ../../apps/web exec next start -p ${port}`,
          url: `http://localhost:${port}/ui/print?count=1`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
