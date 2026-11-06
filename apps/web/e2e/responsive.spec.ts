import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { apiGet, claimFreeBundle, expect, expectNoHorizontalScroll, test } from './fixtures';

/** Real layout checks across phone, tablet and desktop; the stack stays local. */
for (const width of [360, 390, 768, 1280, 1440]) {
  test(`consumer flows and sponsor console fit ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const key = await claimFreeBundle(page);
    const catalogue = await apiGet<PlansResponse>(page, '/plans');
    const routes = [
      '/',
      '/verify',
      `/plan/${encodeURIComponent(key)}`,
      '/install',
      '/pay',
      `/pay?key=${encodeURIComponent(key)}`,
      '/agent',
      '/gift',
      '/gift/claim',
      '/card',
      '/receipts',
      '/sponsor',
      `/sponsor/${catalogue.campaign!.id}`,
      '/plan/ent%3Av1%3Aunknown-key-0000',
      '/card/deadbeef',
      '/offline',
    ];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
      // Body overflow rules can hide a broken layout. Check the actual primary controls too.
      const clipped = await page
        .locator('.ui-button:visible, .ui-field input:visible')
        .evaluateAll((els) =>
          els
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return (
                box.left < -1 || box.right > innerWidth + 1 || box.width < 1 || box.height < 44
              );
            })
            .map((el) => el.textContent?.trim() ?? el.getAttribute('aria-label') ?? el.tagName),
        );
      expect(clipped, `${route}: controls fit and have 44px touch targets`).toEqual([]);
    }
    for (const lang of ['hi', 'mr']) {
      for (const route of ['/', '/pay', '/card', '/gift']) {
        await page.goto(`${route}?lang=${lang}`);
        await page.waitForLoadState('networkidle');
        await expectNoHorizontalScroll(page);
      }
    }
  });
}
