import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { SCREENSHOTS } from './env';
import { claimFreeBundle, expect, expectNoHorizontalScroll, state, test } from './fixtures';

/**
 * Light and dark screenshots of every route at 360 px, written to e2e/__screenshots__ (committed as the visual
 * record), each checked for horizontal scroll. Live data (counts, hashes, times) varies run to run, so these are
 * reviewed images rather than pixel-diff baselines.
 */
mkdirSync(SCREENSHOTS, { recursive: true });

for (const scheme of ['light', 'dark'] as const) {
  test(`screenshots of every route at 360 px · ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 780 });
    const key = await claimFreeBundle(page);
    const k = encodeURIComponent(key);
    const routes: [string, string][] = [
      ['landing', '/'],
      ['verify', '/verify'],
      ['plan', `/plan/${k}`],
      ['install', '/install'],
      ['pay', `/pay?key=${k}`],
      ['agent', '/agent'],
      ['gift', '/gift'],
      ['gift-claim', '/gift/claim'],
      ['receipts', `/receipts?key=${k}`],
      ['card', `/card/${state().cards[0]?.serial ?? ''}`],
      ['sponsor', '/sponsor'],
      ['offline', '/offline'],
    ];
    for (const [name, route] of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: path.join(SCREENSHOTS, `${name}-${scheme}-360.png`), fullPage: true });
    }
    expect(routes.length).toBe(12);
  });
}
