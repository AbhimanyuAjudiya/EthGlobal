import type { MeResponse } from '@ethglobal/protocol/schemas';
import { formatMb } from '@ethglobal/protocol/units';

import { API_URL } from './env';
import { apiGet, claimFreeBundle, expect, storedLpas, storedValues, test } from './fixtures';

test.describe('/pay — the 402 round-trip with the demo wallet', () => {
  test('+1 GB → Review shows $4.00, accepts by network name, approval expiry → demo wallet signs → Sending shows a hash within 1 s → Confirmed +1 GB → meter extends once → Final', async ({
    page,
  }) => {
    const key = await claimFreeBundle(page);
    const before = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}`);
    // the plan's meter before the top-up (the /pay screen itself carries no meter)
    const meter = page.locator('#plan-coupon').getByRole('meter', { name: 'Data left' });
    await expect(meter).toHaveAttribute('aria-valuemax', String(before.mbTotal));
    await page.goto(`/pay?key=${encodeURIComponent(key)}`);
    const sheet = page.locator('.onchain-action');
    await expect(sheet.getByRole('heading', { name: '+1 GB · $4.00' })).toBeVisible();
    // a top-up has no size to pick: the paid lane sells 1 GB only
    await expect(page.getByTestId('pay-option')).toHaveCount(0);
    await expect(page.getByTestId('demo-wallet')).toContainText('demo wallet · Anvil #5');
    await expect(
      page.getByRole('note').filter({ hasText: 'TESTNET · test USDC · not a sale' }),
    ).toBeVisible();
    // pay-from by network name, never a chain id
    const payFrom = page.getByTestId('pay-from');
    await expect(payFrom.getByRole('radio')).toHaveCount(1);
    await expect(payFrom.locator('.chip')).toHaveText([/^Local chain\s*(· )?[\d,]+\.\d{2} USDC$/]);
    await expect(page.getByText('31337')).toHaveCount(0);
    // the fee and the approval window are rows of the Review card above the action
    const review = page.getByRole('list', { name: 'Review' });
    await expect(review).toContainText('$0.00 — paid by the facilitator');
    await expect(review).toContainText(/This approval expires in [45]:\d{2}/);

    let settledAt = 0;
    page.on('response', (res) => {
      if (res.url().startsWith(`${API_URL}/esim/topup`) && res.status() === 200)
        settledAt = Date.now();
    });
    await sheet.getByRole('button', { name: 'Pay $4.00 USDC' }).click();
    const hash = sheet.locator('.hash__value').first();
    await expect(hash).toHaveText(/^0x[0-9a-f]{4}…[0-9a-f]{4}$/);
    const shownAt = Date.now();
    expect(settledAt).toBeGreaterThan(0);
    expect(shownAt - settledAt, 'hash shown after the settlement response (ms)').toBeLessThan(
      1_000,
    );
    await expect(sheet).toHaveAttribute('data-state', 'finalized', { timeout: 20_000 });
    await expect(sheet).toContainText('Paid · Final');
    await expect(sheet).toContainText(`+1 GB · settled · ${formatMb(before.mbTotal + 1000)} total`);

    const me = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}?refresh=1`);
    expect(me.mbTotal).toBe(before.mbTotal + 1000);
    const expectedExpiry = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(me.expiresAt);
    // the Review card's validity row, once the plan's new expiry is known
    await expect(review).toContainText(`Valid with your plan until`);
    await expect(review).toContainText(expectedExpiry);
    // the plan's meter extends once: +1 GB on the same plan
    await page.goto(`/plan/${encodeURIComponent(key)}`);
    await expect(meter).toHaveAttribute('aria-valuemax', String(before.mbTotal + 1000));
  });

  test('wrong-amount payment (forced via test hook) → Failed with decoded reason and the fee note', async ({
    page,
  }) => {
    const key = await claimFreeBundle(page);
    const before = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}`);
    await page.addInitScript(() => {
      (globalThis as { __RECHARGE_TEST__?: unknown }).__RECHARGE_TEST__ = { tamperAmount: true };
    });
    await page.goto(`/pay?key=${encodeURIComponent(key)}`);
    const sheet = page.locator('.onchain-action');
    await sheet.getByRole('button', { name: 'Pay $4.00 USDC' }).click();
    await expect(sheet).toHaveAttribute('data-state', 'failed');
    await expect(sheet).toContainText(
      /Didn.t go through: the (signed amount did not match the price|facilitator rejected the signature)\. Nothing left your account\./,
    );
    await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible();
    // the failure did not touch the plan
    const me = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}`);
    expect(me.mbTotal).toBe(before.mbTotal);
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  });

  test('a new plan bought outright: provision 402 → session-bound nonce → plan with an opened activation code', async ({
    page,
  }) => {
    // an old size link still sells the one size: the `mb` query is ignored, never quoted
    await page.goto('/pay?mb=100');
    const sheet = page.locator('.onchain-action');
    await expect(sheet.getByRole('heading', { name: 'Buy 1 GB · $4.00' })).toBeVisible();
    await expect(page.getByTestId('pay-option')).toHaveText('1 GB · 7 days · $4.00');
    await sheet.getByRole('button', { name: 'Pay $4.00 USDC' }).click();
    await expect(sheet).toHaveAttribute('data-state', 'finalized', { timeout: 20_000 });
    await page.getByRole('link', { name: 'Open my plan' }).click();
    await page.waitForURL(/\/plan\/.+/);
    await expect(page.locator('#plan-coupon .amount__value')).toHaveText('1');
    // T-60: storage holds the opened LPA (encrypted at rest, readable only through its key) and never the session secret
    expect((await storedLpas(page)).some((lpa) => lpa.startsWith('LPA:1$'))).toBe(true);
    const stored =
      (await storedValues(page)).join('\n') +
      JSON.stringify(await page.evaluate(() => ({ ...localStorage })));
    expect(stored).not.toContain('LPA:1$');
    expect(stored).not.toMatch(/secretKey|"secret"/i);
  });
});
