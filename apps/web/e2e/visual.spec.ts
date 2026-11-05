import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { SCREENSHOTS } from './env';
import {
  claimFreeBundle,
  distinctClient,
  expect,
  expectNoHorizontalScroll,
  state,
  test,
} from './fixtures';

import type { Browser, Page } from '@playwright/test';

/**
 * Light and dark screenshots at 360 px, written to e2e/__screenshots__ (committed as the visual record), each
 * checked for horizontal scroll. Live data (counts, hashes, times) varies run to run, so these are reviewed images
 * rather than pixel-diff baselines. Besides every route: the Hindi screens (`?lang=hi`), the error states, the
 * sponsor's campaign page and both phone install states (RT design review #3, #10).
 */
mkdirSync(SCREENSHOTS, { recursive: true });

const IOS_17_4 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

type Scheme = 'light' | 'dark';

async function shoot(page: Page, name: string, route: string, scheme: Scheme, ready?: string) {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
  if (ready) await expect(page.getByTestId(ready)).toBeVisible({ timeout: 30_000 });
  await expectNoHorizontalScroll(page);
  // a phone as tall as the page: the sticky tab bar and action dock land where they end up after scrolling,
  // instead of a full-page capture pinning them over the middle of the screen
  const viewport = page.viewportSize() ?? { width: 360, height: 780 };
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}-${scheme}-360.png`) });
  await page.setViewportSize(viewport);
}

/** /install on a phone: a fresh context with that phone's UA and its own claimed plan (the LPA lives per origin). */
async function shootInstall(browser: Browser, name: string, userAgent: string, scheme: Scheme) {
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 360, height: 780 },
    colorScheme: scheme,
    reducedMotion: 'reduce',
  });
  await distinctClient(context);
  const page = await context.newPage();
  await claimFreeBundle(page);
  await shoot(page, name, '/install', scheme);
  await context.close();
}

for (const scheme of ['light', 'dark'] as const) {
  test(`screenshots of every route at 360 px · ${scheme}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 780 });
    const key = await claimFreeBundle(page);
    const k = encodeURIComponent(key);
    const card = state().cards[0]?.serial ?? '';
    const routes: [string, string, string?][] = [
      ['landing', '/?lang=en'],
      ['verify', '/verify'],
      ['plan', `/plan/${k}`],
      ['install', '/install'],
      ['pay', `/pay?key=${k}`],
      ['agent', '/agent'],
      ['gift', '/gift'],
      ['gift-claim', '/gift/claim'],
      ['receipts', `/receipts?key=${k}`],
      ['card', `/card/${card}`],
      ['sponsor', '/sponsor'],
      ['sponsor-campaign', `/sponsor/${state().campaignId}`, 'sponsor-claims'],
      ['offline', '/offline'],
      // error states
      ['error-plan-unknown', '/plan/ent%3Av1%3Aunknown-key-0000'],
      ['error-card-not-found', '/card/deadbeef'],
      ['error-pay-foreign', '/pay?key=not-a-key'],
      ['error-404', '/this-route-does-not-exist'],
      // Hindi (the link's ?lang=hi is remembered, so it comes last)
      ['landing-hi', '/?lang=hi'],
      ['plan-hi', `/plan/${k}`],
      ['pay-hi', `/pay?key=${k}`],
      ['card-hi', `/card/${card}`],
    ];
    for (const [name, route, ready] of routes) await shoot(page, name, route, scheme, ready);
    await page.goto('/?lang=en');
    expect(routes.length).toBe(21);
  });

  test(`screenshots of /install on iOS and Android at 360 px · ${scheme}`, async ({ browser }) => {
    test.setTimeout(180_000);
    await shootInstall(browser, 'install-ios', IOS_17_4, scheme);
    await shootInstall(browser, 'install-android', ANDROID, scheme);
  });
}
