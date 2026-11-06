import type { MeResponse, PlansResponse } from '@ethglobal/protocol/schemas';
import { formatMb } from '@ethglobal/protocol/units';

import { API_URL } from './env';
import { apiGet, claimFreeBundle, expect, test } from './fixtures';

test.describe('claim: / → /verify → /plan', () => {
  test('landing renders both paths and the live coupon count', async ({ page }) => {
    const plans = await apiGet<PlansResponse>(page, '/plans');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your India trip. Connected.' })).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: `Prove I'm human → ${formatMb(plans.campaign!.bundleMb.orb)}`,
      }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /I.ll pay · 1\sGB for \$4\.00/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Enter a coupon PIN' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open my plan' })).toBeVisible();
    const campaign = plans.campaign;
    expect(campaign).not.toBeNull();
    const fmt = new Intl.NumberFormat('en-IN');
    await expect(page.locator('#landing-coupon .coupon__status')).toHaveText(
      `${fmt.format(campaign?.remainingClaims ?? 0)} of ${fmt.format(campaign?.maxClaims ?? 0)} sponsor bundles left`,
    );
    // the sponsor is named once, on the coupon's line (not again in the count stub, RT design review #2)
    await expect(page.locator('#landing-coupon .coupon__line').first()).toContainText(
      `from ${campaign?.name}`,
    );
    // the unscratched coupon: latex over a ghost PIN row, "rub here" in both scripts, no second wordmark
    await expect(page.locator('#landing-coupon .coupon__latex')).toContainText(
      'rub here · यहाँ रगड़ें',
    );
    await expect(page.locator('#landing-coupon .coupon__wordmark')).toHaveCount(0);
    await expect(page.locator('#landing-coupon .coupon__value')).toHaveText(
      formatMb(campaign!.bundleMb.orb).split(/\s/)[0]!,
    );
    await expect(page.getByTestId('preflight')).toContainText(/eSIM/);
    // no AddToHomeScreen on launch, never "Connect Wallet" as the only CTA
    await expect(page.getByTestId('add-to-home-screen')).toHaveCount(0);
    await expect(page.getByText(/Connect Wallet/i)).toHaveCount(0);
  });

  test('the pay path opens the 402 sheet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /I.ll pay/ }).click();
    await expect(page).toHaveURL(/\/pay$/);
    await expect(page.getByRole('heading', { name: /Buy 1\sGB · \$4\.00/ })).toBeVisible();
    await expect(page.getByTestId('pay-option')).toHaveText(/^1\sGB · 7 days · \$4\.00$/);
  });

  test('/verify calls POST /challenge then POST /world/rp-context before opening IDKit, and the /claim body’s proof equals the IDKit result byte-for-byte (local simulated IDKit)', async ({
    page,
  }) => {
    const order: string[] = [];
    let simulated: unknown;
    let claimed: unknown;
    page.on('request', (req) => {
      if (!req.url().startsWith(API_URL) || req.method() !== 'POST') return;
      const path = new URL(req.url()).pathname;
      order.push(path);
      if (path === '/claim') claimed = (req.postDataJSON() as { proof: unknown }).proof;
    });
    page.on('response', async (res) => {
      if (res.url() === `${API_URL}/__local/world-proof`) simulated = await res.json();
    });
    await claimFreeBundle(page);
    expect(order.slice(0, 4)).toEqual([
      '/challenge',
      '/world/rp-context',
      '/__local/world-proof',
      '/claim',
    ]);
    expect(JSON.stringify(claimed)).toBe(JSON.stringify(simulated));
  });

  test('simulated World ID → /plan shows 1 GB, IssuingRows turn primary in order, odometer runs once, Arkiv key visible', async ({
    page,
  }) => {
    const key = await claimFreeBundle(page);
    expect(key).toMatch(/^ent:/);
    const me = await apiGet<MeResponse>(page, `/me/${encodeURIComponent(key)}`);
    const amount = formatMb(me.mbTotal).split(/\s/)[0]!;
    const coupon = page.locator('#plan-coupon');
    await expect(coupon.locator('.coupon__value')).toHaveText(amount);
    // the lock-screen line: "1 GB · from <sponsor> · because you're human"
    await expect(coupon.locator('.coupon__line').first()).toContainText(
      /from .+ · because you.re human/,
    );
    for (const row of ['issuing-verified', 'issuing-paid', 'issuing-arkiv'])
      await expect(page.getByTestId(row)).toHaveAttribute('data-done', 'true');
    await expect(page.getByTestId('issuing-paid')).toContainText(
      /Sponsor paid\s*0x[0-9a-f]{4}…[0-9a-f]{4}/,
    );
    await expect(page.getByTestId('arkiv-key')).toHaveText(/\S{8,}/, { useInnerText: false });
    await expect(page.getByRole('meter', { name: 'Data left' })).toHaveAttribute(
      'aria-valuenow',
      String(me.mbTotal),
    );
    // second visit: the odometer does not run again
    await page.reload();
    await expect(coupon.locator('.coupon__value')).toHaveText(amount);
    const values = await page.evaluate(async () => {
      const seen: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        seen.push(document.querySelector('#plan-coupon .coupon__value')?.textContent ?? '');
        await new Promise((r) => setTimeout(r, 40));
      }
      return seen;
    });
    expect(new Set(values)).toEqual(new Set([amount]));
  });

  test('second simulated proof with the same nullifier → "This World ID claimed its bundle…" state', async ({
    page,
  }) => {
    await claimFreeBundle(page);
    await page.goto('/verify');
    await page.getByRole('button', { name: 'Simulated World ID' }).click();
    await expect(page.getByTestId('nullifier-seen')).toContainText(
      'This World ID claimed its bundle',
    );
    await expect(page.getByRole('link', { name: 'Open that plan' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pay for more' })).toBeVisible();
    // no shield-check, no "Verified human" pill after World returns
    await expect(page.getByText('Verified human')).toHaveCount(0);
  });
});
