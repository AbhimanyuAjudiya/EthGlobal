import type { MeResponse, PlansResponse } from '@ethglobal/protocol/schemas';
import { formatMb } from '@ethglobal/protocol/units';

import { API_URL } from './env';
import { apiGet, claimFreeBundle, expect, test } from './fixtures';

test.describe('claim: / → /verify → /plan', () => {
  test('landing renders both paths and the live coupon count', async ({ page }) => {
    const plans = await apiGet<PlansResponse>(page, '/plans');
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Land in India. Be online in two minutes.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: `Prove I'm human → ${formatMb(plans.campaign!.bundleMb.orb)}`,
      }),
    ).toBeVisible();
    // the other paths: Pay instead / Scratch card QuickActions, and "My plan" under "Everything else"
    await expect(page.getByRole('link', { name: 'Pay instead', exact: true })).toHaveAttribute('href', '/pay');
    await expect(page.getByRole('link', { name: 'Scratch card', exact: true })).toHaveAttribute('href', '/card');
    await expect(page.getByRole('link', { name: /^My plan/ })).toHaveAttribute('href', '/plan');
    const campaign = plans.campaign;
    expect(campaign).not.toBeNull();
    const fmt = new Intl.NumberFormat('en-IN');
    await expect(page.locator('#landing-coupon .balance-card__note')).toHaveText(
      `free · ${fmt.format(campaign?.remainingClaims ?? 0)} of ${fmt.format(campaign?.maxClaims ?? 0)} left`,
    );
    // the sponsor is named once, on the card's caption (not again in the count, RT design review #2)
    await expect(page.locator('#landing-coupon .balance-card__caption')).toHaveText(
      `from ${campaign?.name}`,
    );
    await expect(page.locator('#landing-coupon').getByText(campaign!.name)).toHaveCount(1);
    // the card names itself for assistive tech; no second wordmark inside it
    await expect(page.locator('#landing-coupon')).toHaveAttribute(
      'aria-label',
      `${formatMb(campaign!.bundleMb.orb)} of free data`,
    );
    await expect(page.locator('#landing-coupon .wordmark')).toHaveCount(0);
    await expect(page.locator('#landing-coupon .amount__value')).toHaveText(
      formatMb(campaign!.bundleMb.orb).split(/\s/)[0]!,
    );
    await expect(page.getByTestId('preflight')).toContainText(/eSIM/);
    // no AddToHomeScreen on launch, never "Connect Wallet" as the only CTA
    await expect(page.getByTestId('add-to-home-screen')).toHaveCount(0);
    await expect(page.getByText(/Connect Wallet/i)).toHaveCount(0);
  });

  test('the pay path opens the 402 sheet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Pay instead', exact: true }).click();
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
    let claimedSession: unknown;
    let lastChallengeSession: unknown;
    page.on('request', (req) => {
      if (!req.url().startsWith(API_URL) || req.method() !== 'POST') return;
      const path = new URL(req.url()).pathname;
      order.push(path);
      if (path === '/challenge')
        lastChallengeSession = (req.postDataJSON() as { sessionPubKey: unknown }).sessionPubKey;
      if (path === '/claim') {
        const body = req.postDataJSON() as { proof: unknown; sessionPubKey: unknown };
        claimed = body.proof;
        claimedSession = body.sessionPubKey;
      }
    });
    page.on('response', async (res) => {
      if (res.url() === `${API_URL}/__local/world-proof`) simulated = await res.json();
    });
    await claimFreeBundle(page);
    // Two challenges by design: VerifySheet prepares on mount, then again once /plans names the campaign, because the
    // recovery session (and so the sessionPubKey the challenge binds) is per campaign. The claim must use the second.
    expect(order.slice(0, 5)).toEqual([
      '/challenge',
      '/challenge',
      '/world/rp-context',
      '/__local/world-proof',
      '/claim',
    ]);
    expect(claimedSession).toBe(lastChallengeSession);
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
    await expect(coupon.locator('.amount__value')).toHaveText(amount);
    // where it came from: the sponsor on the Details "From" row, "because you're human" as the Verified fact
    await expect(page.locator('.list-row', { hasText: /^From/ })).toContainText(
      me.sponsorName ?? 'Verified',
    );
    await expect(page.getByTestId('issuing-verified')).toContainText(/^Verified · (Orb|Document)$/);
    for (const row of ['issuing-verified', 'issuing-paid', 'issuing-arkiv'])
      await expect(page.getByTestId(row).locator('.avatar')).toHaveAttribute('data-tone', 'positive');
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
    await expect(coupon.locator('.amount__value')).toHaveText(amount);
    const values = await page.evaluate(async () => {
      const seen: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        seen.push(document.querySelector('#plan-coupon .amount__value')?.textContent ?? '');
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
