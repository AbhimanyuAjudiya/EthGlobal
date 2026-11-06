import { claimFreeBundle, expect, storedLpas, test } from './fixtures';

import type { Page } from '@playwright/test';

const IOS_17_4 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

async function openedLpa(page: Page): Promise<string> {
  return (await storedLpas(page)).find((v) => v.startsWith('LPA:1$')) ?? '';
}

test.describe('/install — honest by platform', () => {
  test.describe('iOS 17.4', () => {
    test.use({ userAgent: IOS_17_4 });
    test('iOS UA → universal link href matches esimsetup.apple.com with the opened LPA; "Didn\'t open? Tap again" present; no QR visible', async ({
      page,
    }) => {
      await claimFreeBundle(page);
      await page.goto('/install');
      const lpa = await openedLpa(page);
      expect(lpa).toMatch(/^LPA:1\$local\.test\$[0-9A-F]{16}$/);
      const link = page.getByTestId('ios-universal-link');
      await expect(link).toHaveAttribute(
        'href',
        `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpa)}`,
      );
      await expect(link).toHaveAttribute('rel', 'noreferrer');
      await expect(
        page.getByText("Didn't open? Tap again — iOS sometimes fails on the first try."),
      ).toBeVisible();
      await expect(
        page.getByText('Settings → Cellular → Recharge → Data Roaming on').first(),
      ).toBeVisible();
      await expect(page.locator('svg.qr-code')).toHaveCount(0);
      // Desktop Chrome UA (no coarse pointer): a computer says what the state is, not a phone's status-bar words
      await expect(page.getByTestId('status-pill')).toHaveText('Not installed yet');
      await expect(page.getByTestId('copy-activation-code')).toHaveCount(0);
    });
  });

  test.describe('Android', () => {
    test.use({ userAgent: ANDROID });
    test('Android UA → Copy activation code primary; Settings steps; intent link labelled unverified; no "one tap" string', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await claimFreeBundle(page);
      await page.goto('/install');
      const lpa = await openedLpa(page);
      expect(lpa).toMatch(/^LPA:1\$/);
      await expect(page.getByTestId('ios-universal-link')).toHaveCount(0);
      const copy = page.getByTestId('copy-activation-code');
      await expect(copy).toHaveText(/Copy activation code/);
      await copy.click();
      await expect(copy).toHaveText(/Copied/);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(lpa);
      await expect(page.getByText('Settings → Network & internet → SIMs')).toBeVisible();
      await expect(page.getByText('Add SIM → Set up manually')).toBeVisible();
      const intent = page.getByTestId('android-intent');
      await expect(intent).toHaveAttribute(
        'href',
        'intent:#Intent;action=android.telephony.euicc.action.MANAGE_EMBEDDED_SUBSCRIPTIONS;end',
      );
      await expect(page.getByText('unverified on your device — test Wed')).toBeVisible();
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(body).not.toContain('one tap');
      expect(body).not.toContain('one-tap');
      expect(body).not.toContain('instantly');
    });

    test('second device QR only after the tap and hidden after 60 s (clock mocked)', async ({
      page,
    }) => {
      await page.clock.install();
      await claimFreeBundle(page);
      await page.goto('/install');
      await expect(page.locator('svg.qr-code')).toHaveCount(0);
      await page.getByTestId('another-phone').click();
      await expect(page.getByTestId('second-device-qr')).toBeVisible();
      await expect(page.getByText('Anyone who scans this can install your eSIM')).toBeVisible();
      await expect(page.locator('svg.qr-code')).toHaveCount(1);
      await page.clock.runFor(61_000);
      await expect(page.locator('svg.qr-code')).toHaveCount(0);
      await expect(page.getByTestId('another-phone')).toBeVisible();
    });
  });

  test('/install accepts no URL parameter (navigating with ?lpa= renders nothing)', async ({
    page,
  }) => {
    const planted = 'LPA:1$evil.example$PLANTED';
    await page.goto(
      `/install?lpa=${encodeURIComponent(planted)}&carddata=${encodeURIComponent(planted)}`,
    );
    await expect(page.getByText(/No activation code on this device/)).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('PLANTED');
  });

  test('Check connection reports from the 1 KB probe', async ({ page }) => {
    await page.goto('/install');
    await page.getByRole('button', { name: 'Check connection' }).click();
    await expect(page.locator('.connection-check__result')).toHaveText(/Online/);
    await expect(page.getByText('LTE usually shows 1–3 min after install')).toBeVisible();
  });
});
