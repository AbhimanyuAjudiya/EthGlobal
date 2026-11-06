import AxeBuilder from '@axe-core/playwright';

import type { MeResponse, PaymentRequired } from '@ethglobal/protocol/schemas';
import { decodePaymentRequired, encodePaymentRequired } from '@ethglobal/protocol/x402';

import { API_URL } from './env';
import { claimFreeBundle, expect, expectNoHorizontalScroll, test } from './fixtures';

// Contract fixtures expose the native choice without asking an external wallet to sign or moving funds.
for (const width of [360, 1280]) {
  test(`native checkout and payer cancellation controls fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const key = await claimFreeBundle(page);
    await page.route(`${API_URL}/esim/provision*`, async (route) => {
      const response = await route.fetch();
      const original = decodePaymentRequired(response.headers()['payment-required']!);
      const native: PaymentRequired = {
        ...original,
        accepts: [
          {
            ...original.accepts[0]!,
            network: 'hedera:testnet',
            asset: '0.0.429274',
            payTo: '0.0.5005',
            maxTimeoutSeconds: 180,
            extra: {
              feePayer: '0.0.9185802',
              sessionKeyRequired: true,
              sessionBinding: 'hedera-memo-v1',
            },
          },
        ],
      };
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'payment-required': encodePaymentRequired(native) },
      });
    });
    await page.goto('/pay');
    await expect(page.getByTestId('hashpack-connect')).toBeVisible();
    await expect(page.getByTestId('pay-from').getByRole('radio')).toBeChecked();
    await expect(page.getByText('Connect HashPack first')).toBeVisible();
    await expect(page.getByText(/Hedera pays top-ups only/)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    let accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      accessibility.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
    ).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.screenshot({ path: `/tmp/recharge-native-checkout-${width}.png`, fullPage: true });

    await page.route(`${API_URL}/me/*`, async (route) => {
      const response = await route.fetch();
      const me = (await response.json()) as MeResponse;
      await route.fulfill({
        response,
        json: {
          ...me,
          kind: 'paid',
          network: 'hedera:testnet',
          refundable: { usd6: '1200000', network: 'hedera:testnet', to: '0.0.7001' },
        },
      });
    });
    await page.goto(`/plan/${encodeURIComponent(key)}`);
    await page.getByRole('button', { name: 'Cancel plan & refund $1.20' }).click();
    await expect(
      page.getByRole('button', { name: 'Connect the HashPack account that paid' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Connect the wallet that paid', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId('plan-cancel-confirm')).toContainText('0.0.7001');
    await expectNoHorizontalScroll(page);
    accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      accessibility.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
    ).toEqual([]);
    const keep = page.getByRole('button', { name: 'Keep my plan' });
    await keep.scrollIntoViewIfNeeded();
    await expect(keep).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.screenshot({ path: `/tmp/recharge-native-cancel-${width}.png`, fullPage: true });
    await keep.click();
    await expect(page.getByTestId('plan-cancel-confirm')).toHaveCount(0);
    await page.goto('/agent');
    await expect(page.getByRole('link', { name: 'Add data manually' })).toHaveAttribute(
      'href',
      `/pay?key=${encodeURIComponent(key)}`,
    );
    await expect(page.getByRole('button', { name: 'Save and enable policy' })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
}
