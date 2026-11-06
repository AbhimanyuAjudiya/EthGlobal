import { BASE_URL } from './env';
import { expect, test } from './fixtures';

/**
 * Lighthouse's PWA "installable" criteria, checked directly: a valid manifest (name, standalone, start_url, icons
 * 192 + 512 incl. maskable, theme colour), a service worker that controls the page, and an offline fallback.
 */
test.describe('PWA installable', () => {
  test.use({ serviceWorkers: 'allow' });

  test('manifest + icons are valid and served', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/manifest.webmanifest`);
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      theme_color: string;
      background_color: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    expect(manifest).toMatchObject({ name: 'Recharge', display: 'standalone', start_url: '/plan' });
    // the sRGB of --bg-canvas (DESIGN.md v3: #ffffff)
    expect(manifest.background_color).toBe('#ffffff');
    for (const size of ['192x192', '512x512']) {
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === 'any')).toBe(true);
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === 'maskable')).toBe(true);
    }
    for (const icon of manifest.icons) {
      const png = await request.get(`${BASE_URL}${icon.src}`);
      expect(png.ok(), icon.src).toBe(true);
      const body = await png.body();
      expect(body.subarray(1, 4).toString('latin1')).toBe('PNG');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(body.readUInt32BE(16)).toBe(w);
      expect(body.readUInt32BE(20)).toBe(h);
    }
  });

  test('the service worker controls the page and serves /offline when the network is gone', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await context.setOffline(true);
    await page.goto('/receipts');
    await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
    await context.setOffline(false);
  });

  test('the service worker never caches API, card, gift or plan data (T-61)', async ({
    request,
  }) => {
    const sw = await (await request.get(`${BASE_URL}/sw.js`)).text();
    expect(sw.replace(/\s+/g, '')).toContain('claim|esim|card|me|gift|agent|sponsor');
    expect(sw).toContain('url.origin !== self.location.origin');
  });
});
