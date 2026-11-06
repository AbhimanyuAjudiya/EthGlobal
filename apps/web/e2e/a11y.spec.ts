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
    // the language comes from the ?lang= link (the in-app EN / हिं / मरा switch was removed); it is remembered
    const title = page.locator('.page-header__title');
    const leading = () =>
      title.evaluate((el) => {
        const s = getComputedStyle(el);
        return parseFloat(s.lineHeight) / parseFloat(s.fontSize);
      });
    await page.goto('/?lang=en');
    await expect(title).toHaveText('Land in India. Be online in two minutes.');
    const latin = await leading();
    await page.goto('/?lang=hi');
    await expect(title).toHaveText('भारत पहुँचें। 2 मिनट में ऑनलाइन हों।');
    await expect(page.locator('.page-header')).toHaveAttribute('lang', 'hi');
    await expect(page.locator('#landing-coupon')).toHaveAttribute('lang', 'hi');
    await expect(page.locator('#landing-coupon .balance-card__caption')).toContainText(
      'की ओर से',
    );
    await expect(page.locator('#landing-coupon .balance-card__note')).toContainText('मुफ़्त');
    // DESIGN.md v3 §3: Devanagari gets the style's leading + 0.15
    expect((await leading()) - latin).toBeCloseTo(0.15, 2);
    await page.goto('/verify');
    // hydration re-renders the server's English copy in the stored language: wait for the one header
    await expect(page.locator('#verify-title')).toHaveCount(1);
    await expect(page.locator('#verify-title')).toHaveText('साबित करें कि आप एक इंसान हैं');
    await page.goto('/verify?lang=mr');
    // hydration re-renders the server's English copy in the stored language: wait for the one header
    await expect(page.locator('#verify-title')).toHaveCount(1);
    await expect(page.locator('#verify-title')).toHaveText('तुम्ही एक माणूस आहात हे सिद्ध करा');
    await expect(page.locator('.page-header:has(#verify-title)')).toHaveAttribute('lang', 'mr');
    await page.goto('/?lang=en');
  });

  test('focus ring visible on every control', async ({ page }) => {
    await page.goto('/');
    await page.locator('#landing-coupon').waitFor();
    const missing: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // a QuickAction draws the ring around its round icon, not the label below it
        const ringed = el.matches('.quick-actions__item')
          ? (el.querySelector<HTMLElement>('.quick-actions__icon') ?? el)
          : el;
        const s = getComputedStyle(ringed);
        return {
          tag: `${el.tagName} ${el.textContent?.trim().slice(0, 30) ?? ''}`,
          width: s.outlineWidth,
          style: s.outlineStyle,
          offset: s.outlineOffset,
        };
      });
      if (!ring) continue;
      // 2 px ring, 2 px off the control; inset (-2 px) where a ListGroup / tab bar clips its rows' overflow
      if (ring.style === 'none' || ring.width !== '2px' || !['2px', '-2px'].includes(ring.offset))
        missing.push(JSON.stringify(ring));
    }
    expect(missing).toEqual([]);
  });
});
