import type { MeResponse } from '@ethglobal/protocol/schemas';

import { API_URL } from './env';
import { apiGet, claimFreeBundle, expect, test } from './fixtures';

test.describe('/plan/[key]', () => {
  test('usage as of HH:MM equals usageAsOf, not ledgerReadAt; expiry text derives from expiresAt; simulated usage label', async ({
    page,
  }) => {
    const key = await claimFreeBundle(page);
    const me = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}`);
    const usage = page.locator('#plan-coupon .usage-as-of time');
    await expect(usage).toHaveAttribute('datetime', new Date(me.usageAsOf).toISOString());
    const hhmm = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(me.usageAsOf);
    await expect(usage).toHaveText(`usage as of ${hhmm}`);
    const expiry = page.getByTestId('plan-expiry').locator('time');
    await expect(expiry).toHaveAttribute('datetime', new Date(me.expiresAt).toISOString());
    await expect(expiry).toHaveText(
      /^Expires in \d+ d \d+ h · \w{3} \d{1,2} \w{3} \d{2}:\d{2} IST$/,
    );
    await expect(page.locator('#plan-coupon .balance-card__note')).toHaveText('simulated usage');
    await expect(page.getByTestId('degraded-banner')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Install eSIM · 2 min' })).toBeVisible();
    // the top-up is the plan's "Add data" QuickAction, for this plan's key
    await expect(
      page.locator('.quick-actions').getByRole('link', { name: 'Add data', exact: true }),
    ).toHaveAttribute('href', `/pay?key=${encodeURIComponent(key)}`);
    // the Details row carries the Arkiv entity key, shown directly (no disclosure)
    await expect(page.getByTestId('arkiv-key')).toHaveText(me.arkivKey);
  });

  test('degraded banner when /me says degraded', async ({ page }) => {
    const key = await claimFreeBundle(page);
    await page.route(`${API_URL}/me/*`, async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as MeResponse;
      await route.fulfill({ response: res, json: { ...body, degraded: true, cached: true } });
    });
    await page.goto(`/plan/${encodeURIComponent(key)}`);
    await expect(page.getByTestId('degraded-banner')).toHaveText(
      'Ledger degraded · showing the last reading',
    );
  });

  test('AddToHomeScreen appears after issue, never on /', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#landing-coupon')).toBeVisible();
    await expect(page.getByTestId('add-to-home-screen')).toHaveCount(0);
    await claimFreeBundle(page);
    await expect(page.getByTestId('add-to-home-screen')).toBeVisible();
    await expect(page.getByTestId('add-to-home-screen')).toContainText(
      'Add Recharge to your Home Screen to open your saved plan quickly.',
    );
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByTestId('add-to-home-screen')).toHaveCount(0);
  });

  test('NotificationAsk absent when not standalone', async ({ page }) => {
    await claimFreeBundle(page);
    await expect(page.getByTestId('notification-ask')).toHaveCount(0);
    await expect(page.getByTestId('notification-unavailable')).toHaveText(
      'Background notifications are not available yet. Open your plan to check its data and activation status.',
    );
  });

  test.describe('in the Home Screen app', () => {
    test.beforeEach(async ({ page }) => {
      // emulate display-mode: standalone (Playwright has no display-mode emulation)
      await page.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q: string) =>
          q.includes('display-mode: standalone')
            ? ({
                matches: true,
                media: q,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
              } as unknown as MediaQueryList)
            : real(q);
        // headless Chromium reports "denied"; a fresh phone has not been asked yet
        Object.defineProperty(Notification, 'permission', { get: () => 'default' });
      });
    });
    test('standalone does not promise unconfigured background notifications', async ({ page }) => {
      await claimFreeBundle(page);
      await expect(page.getByTestId('notification-unavailable')).toContainText(
        'Background notifications are not available yet.',
      );
      await expect(page.getByRole('button', { name: 'Allow notifications' })).toHaveCount(0);
      // the Home Screen app does not ask to be added again
      await expect(page.getByTestId('add-to-home-screen')).toHaveCount(0);
    });
  });

  test('an unknown key renders its own state', async ({ page }) => {
    await page.goto('/plan/ent%3Av1%3Aunknown-key-0000');
    await expect(
      page.getByText(/No plan with this key on this device|This plan has expired/),
    ).toBeVisible();
  });
});
