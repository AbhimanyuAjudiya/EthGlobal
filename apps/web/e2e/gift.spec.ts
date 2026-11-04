import { distinctClient, expect, test } from './fixtures';

import type { Page } from '@playwright/test';

/** Gift `mb` to rahul.eth from the demo wallet; returns the boarding pass's giftId, PIN and serial. */
async function sendGift(page: Page, mb: '300' | '1' = '1') {
  await page.goto('/gift');
  await expect(page.getByRole('heading', { name: 'Who gets it?' })).toBeVisible();
  await page.getByTestId('gift-name').fill('rahul.eth');
  await expect(page.getByTestId('gift-resolution')).toHaveText(
    'rahul.eth resolves · the address is printed on the pass',
  );
  await page
    .getByRole('radio', { name: mb === '1' ? /^1\sGB · \$4\.00$/ : /^300\sMB · \$1\.20$/ })
    .click();
  // the reclaim rule, stated BEFORE paying (D-7)
  await expect(page.getByTestId('gift-rule')).toHaveText(
    /^If unclaimed by \w{3} \d{1,2} \w{3}, you can reclaim the USDC \(minus network fee\) here until \w{3} \d{1,2} \w{3}$/,
  );
  const sheet = page.locator('.onchain-action');
  await expect(
    sheet.getByRole('heading', {
      name: mb === '1' ? 'Gift 1 GB to rahul.eth · $4.00' : 'Gift 300 MB to rahul.eth · $1.20',
    }),
  ).toBeVisible();
  await sheet.getByRole('button', { name: /^Pay \$/ }).click();
  const result = page.getByTestId('gift-result');
  await expect(result).toBeVisible({ timeout: 20_000 });
  const pin = (await result.locator('.boarding-pass__pin').innerText())
    .replace(/^PIN\s*/, '')
    .trim();
  const serial = (await result.locator('.boarding-pass__serial').innerText()).trim();
  const href = await result.getByRole('link', { name: 'Claim a gift' }).getAttribute('href');
  return { pin, serial, claimHref: href ?? '' };
}

test.describe('/gift — a boarding pass addressed to a name', () => {
  test('name resolves live; reclaim copy visible before paying; pay → BoardingPass with 16-digit PIN 4×4 and QR to /card/<serial>', async ({
    page,
  }) => {
    await page.goto('/gift');
    await page.getByTestId('gift-name').fill('nobody.eth');
    await expect(page.getByTestId('gift-resolution')).toHaveText(
      'nobody.eth has no address set. Gift by PIN instead.',
    );
    const { pin, serial } = await sendGift(page, '1');
    expect(pin).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/);
    expect(serial).toMatch(/^[0-9a-f]{8}$/);
    const qr = page.locator('.boarding-pass svg.qr-code');
    await expect(qr).toHaveAttribute('data-qr-url', new RegExp(`/card/${serial}$`));
    await expect(page.locator('.boarding-pass')).toContainText('rahul.eth');
    await expect(page.getByText(/rahul\.eth →/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save card' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await expect(page.locator('.onchain-action')).toHaveAttribute('data-state', 'finalized', {
      timeout: 20_000,
    });
  });

  test('claim by signature → /plan', async ({ page, browser }) => {
    const { claimHref } = await sendGift(page, '300');
    // the recipient: a fresh browser whose demo wallet is rahul.eth (Anvil #9)
    const recipient = await browser.newContext();
    await distinctClient(recipient);
    const r = await recipient.newPage();
    await r.goto(claimHref);
    await expect(r.getByTestId('demo-wallet')).toContainText('Anvil #9');
    await r.getByTestId('claim-by-signature').click();
    await r.waitForURL(/\/plan\/giftent.+/);
    await expect(r.locator('#plan-coupon .coupon__value')).toHaveText('300');
    await recipient.close();
  });

  test('claim by PIN → /plan', async ({ page, browser }) => {
    const { pin } = await sendGift(page, '300');
    const holder = await browser.newContext();
    await distinctClient(holder);
    const p = await holder.newPage();
    await p.goto('/gift/claim');
    await p.getByTestId('gift-pin').fill(pin);
    await p.getByRole('button', { name: 'Claim', exact: true }).click();
    await p.waitForURL(/\/plan\/.+/);
    await expect(p.locator('#plan-coupon .coupon__value')).toHaveText('300');
    await holder.close();
  });
});
