import AxeBuilder from '@axe-core/playwright';

import { claimFreeBundle, expect, expectNoHorizontalScroll, state, test } from './fixtures';

const STATIC_ROUTES = [
  '/',
  '/verify',
  '/pay',
  '/install',
  '/gift',
  '/gift/claim',
  '/card',
  '/receipts',
  '/agent',
  '/sponsor',
  '/offline',
];

test.describe('accessibility', () => {
  test('axe has no serious violations on every route', async ({ page }) => {
    const key = await claimFreeBundle(page);
    const routes = [
      ...STATIC_ROUTES,
      `/plan/${encodeURIComponent(key)}`,
      `/card/${state().cards[0]?.serial ?? ''}`,
    ];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${route}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(' ') ?? ''}`);
      expect(serious, serious.join('\n')).toEqual([]);
    }
  });

  test('no horizontal scroll at 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const key = await claimFreeBundle(page);
    for (const route of [
      ...STATIC_ROUTES,
      `/plan/${encodeURIComponent(key)}`,
      `/pay?key=${encodeURIComponent(key)}`,
    ]) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
    }
  });

  test('Hindi strings carry lang="hi" and Marathi lang="mr"', async ({ page }) => {
    await page.goto('/');
    // at phone width (390 px) the language switch lives in the menu's sheet; the header row is wordmark · wallet · Menu
    await expect(page.locator('.app-header__right > .lang-switch')).toBeHidden();
    await page.locator('.app-header__right > .menu-toggle:not(.wallet-toggle)').click();
    await page.getByRole('dialog').getByRole('button', { name: 'हिं' }).click();
    const title = page.locator('.landing__title');
    await expect(title).toHaveText('भारत की यात्रा। जुड़े रहें।');
    await expect(title).toHaveAttribute('lang', 'hi');
    await expect(page.locator('#landing-coupon')).toHaveAttribute('lang', 'hi');
    await expect(page.locator('#landing-coupon .coupon__line').first()).toContainText(
      'क्योंकि आप इंसान हैं',
    );
    const lineHeight = await title.evaluate((el) => {
      const s = getComputedStyle(el);
      return parseFloat(s.lineHeight) / parseFloat(s.fontSize);
    });
    expect(lineHeight).toBeGreaterThanOrEqual(1.59);
    await page.goto('/verify');
    await expect(page.locator('#verify-title')).toHaveText('साबित करें कि आप एक इंसान हैं');
    await page.locator('.app-header__right > .menu-toggle:not(.wallet-toggle)').click();
    await page.getByRole('dialog').getByRole('button', { name: 'मरा' }).click();
    await expect(page.locator('#verify-title')).toHaveText('तुम्ही एक माणूस आहात हे सिद्ध करा');
    await expect(page.locator('#verify-title')).toHaveAttribute('lang', 'mr');
    await page.getByRole('dialog').getByRole('button', { name: 'EN' }).click();
  });

  test('focus ring visible on every control', async ({ page }) => {
    await page.goto('/');
    await page.locator('.coupon').waitFor();
    const missing: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return {
          tag: `${el.tagName} ${el.textContent?.trim().slice(0, 30) ?? ''}`,
          width: s.outlineWidth,
          style: s.outlineStyle,
          offset: s.outlineOffset,
        };
      });
      if (!ring) continue;
      if (ring.style === 'none' || ring.width !== '2px' || ring.offset !== '2px')
        missing.push(JSON.stringify(ring));
    }
    expect(missing).toEqual([]);
  });
});
