import { readFileSync } from 'node:fs';

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

import { API_URL, STATE_FILE } from './env';

import type { E2eState } from './global-setup';

let ipCounter = Math.floor(Math.random() * 200);

/**
 * Each test is its own client address (the API runs with TRUST_PROXY=1 locally), so the per-IP limits on
 * /claim and /challenge (5 and 10 per minute) do not couple unrelated tests. Nothing else is altered.
 */
export async function distinctClient(context: BrowserContext): Promise<void> {
  ipCounter += 1;
  const ip = `198.19.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
  await context.route(`${API_URL}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  );
}

export const test = base.extend<{ client: void }>({
  client: [
    async ({ context }, use) => {
      await distinctClient(context);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

export const state = (): E2eState => JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;

/** `/` → "Prove I'm human" → /verify → the local simulated World ID → /plan/<key>. Returns the key. */
export async function claimFreeBundle(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('link', { name: /Prove I.m human/ }).click();
  await expect(page).toHaveURL(/\/verify$/);
  const button = page.getByRole('button', { name: 'Simulated World ID' });
  await expect(button).toBeEnabled();
  await button.click();
  await page.waitForURL(/\/plan\/.+/, { timeout: 30_000 });
  await expect(page.getByTestId('issuing-arkiv')).toHaveAttribute('data-done', 'true');
  return decodeURIComponent(new URL(page.url()).pathname.replace(/^\/plan\//, ''));
}

/** A JSON call straight to the API (assertions only; the app itself goes through lib/api.ts). */
export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`${API_URL}${path}`, {
    headers: { 'x-forwarded-for': `198.20.0.${(ipCounter % 250) + 1}` },
  });
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

/** The page never scrolls sideways at this width. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}
