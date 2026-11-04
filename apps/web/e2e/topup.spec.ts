import { API_URL } from './env';
import { apiGet, claimFreeBundle, expect, test } from './fixtures';

import type { MeResponse } from '@ethglobal/protocol/schemas';

test.describe('/pay — the 402 round-trip with the demo wallet', () => {
  test('Add 100 MB → Review shows $0.40, accepts by network name, approval expiry → demo wallet signs → Sending shows a hash within 1 s → Confirmed +100 MB → meter extends once → Final', async ({
    page,
  }) => {
    const key = await claimFreeBundle(page);
    await page.goto(`/pay?key=${encodeURIComponent(key)}`);
    const sheet = page.locator('.onchain-action');
    await expect(sheet.getByRole('heading', { name: 'Add 100 MB · $0.40' })).toBeVisible();
    await expect(page.getByTestId('demo-wallet')).toContainText('demo wallet · Anvil #5');
    await expect(page.getByRole('note').filter({ hasText: 'TESTNET · test USDC · not a sale' })).toBeVisible();
    // pay-from by network name, never a chain id
    const payFrom = page.getByTestId('pay-from');
    await expect(payFrom.getByRole('radio')).toHaveText([/^Local chain · [\d,]+\.\d{2} USDC$/]);
    await expect(page.getByText('31337')).toHaveCount(0);
    await expect(sheet).toContainText('$0.00 — paid by the facilitator');
    await expect(sheet).toContainText(/This approval expires in [45]:\d{2}/);
    await expect(page.getByRole('meter', { name: 'Data left' })).toHaveAttribute('aria-valuemax', '300');

    let settledAt = 0;
    page.on('response', (res) => {
      if (res.url().startsWith(`${API_URL}/esim/topup`) && res.status() === 200) settledAt = Date.now();
    });
    await sheet.getByRole('button', { name: 'Pay $0.40 USDC' }).click();
    const hash = sheet.locator('.hash__value').first();
    await expect(hash).toHaveText(/^0x[0-9a-f]{4}…[0-9a-f]{4}$/);
    const shownAt = Date.now();
    expect(settledAt).toBeGreaterThan(0);
    expect(shownAt - settledAt, 'hash shown after the settlement response (ms)').toBeLessThan(1_000);
    await expect(sheet).toHaveAttribute('data-state', 'finalized', { timeout: 20_000 });
    await expect(sheet).toContainText('Paid · Final');
    await expect(sheet).toContainText('+100 MB · settled · 400 MB total');
    await expect(page.getByRole('meter', { name: 'Data left' })).toHaveAttribute('aria-valuemax', '400');

    const me = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}?refresh=1`);
    expect(me.mbTotal).toBe(400);
  });

  test('wrong-amount payment (forced via test hook) → Failed with decoded reason and the fee note', async ({
    page,
  }) => {
    const key = await claimFreeBundle(page);
    await page.addInitScript(() => {
      (globalThis as { __RECHARGE_TEST__?: unknown }).__RECHARGE_TEST__ = { tamperAmount: true };
    });
    await page.goto(`/pay?key=${encodeURIComponent(key)}`);
    const sheet = page.locator('.onchain-action');
    await sheet.getByRole('button', { name: 'Pay $0.40 USDC' }).click();
    await expect(sheet).toHaveAttribute('data-state', 'failed');
    await expect(sheet).toContainText(/Didn.t go through: the (signed amount did not match the price|facilitator rejected the signature)\. Nothing left your account\./);
    await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible();
    // the failure did not touch the plan
    const me = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}`);
    expect(me.mbTotal).toBe(300);
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  });

  test('a new plan bought outright: provision 402 → session-bound nonce → plan with an opened activation code', async ({
    page,
  }) => {
    await page.goto('/pay?mb=100');
    const sheet = page.locator('.onchain-action');
    await expect(sheet.getByRole('heading', { name: 'Buy 100 MB · $0.40' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Pay $0.40 USDC' }).click();
    await expect(sheet).toHaveAttribute('data-state', 'finalized', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Open my plan' }).click();
    await page.waitForURL(/\/plan\/.+/);
    await expect(page.locator('#plan-coupon .coupon__value')).toHaveText('100');
    // T-60: storage holds the opened LPA and the key, never the session secret
    const stored = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('recharge');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const all = await new Promise<unknown[]>((resolve) => {
        const r = db.transaction('kv').objectStore('kv').getAll();
        r.onsuccess = () => resolve(r.result);
      });
      return JSON.stringify(all) + JSON.stringify({ ...localStorage });
    });
    expect(stored).toContain('LPA:1$');
    expect(stored).not.toMatch(/secretKey|"secret"/i);
  });
});
