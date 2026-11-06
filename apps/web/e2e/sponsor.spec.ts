import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { apiGet, claimFreeBundle, expect, test } from './fixtures';

const DAY = 86_400_000;
/** A datetime-local value in this device's time zone, as the form reads it back. */
const local = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

test("sponsor: create → approve → createCampaign (two OnchainAction rows, hashes shown) → register → audit key shown once with copy → table lists HMAC'd keys only → pause via slide-to-confirm", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/sponsor');
  await expect(page.getByTestId('demo-wallet')).toContainText('Anvil #3');
  await page.getByTestId('campaign-name').fill('Mumbai Arrivals e2e');
  await page.getByRole('textbox', { name: 'Destination country' }).fill('IN');
  await page.getByRole('button', { name: 'Find destination plans' }).click();
  await page.getByLabel('Provider package').selectOption({ index: 1 });
  await page.getByTestId('campaign-budgetUsd').fill('50');
  await page.getByTestId('campaign-priceUsd').fill('1.20'); // the package prefills wholesale; the API's floor is higher
  const startsAt = Date.now() + 10 * DAY;
  for (const [key, at] of Object.entries({
    startsAt,
    endsAt: startsAt + 2 * DAY,
    claimUntil: startsAt + DAY,
    reclaimAfter: startsAt + 2 * DAY,
  }))
    await page.getByTestId(`campaign-${key}`).fill(local(at));
  await page.getByTestId('campaign-submit').click();

  const rows = page.locator('.sponsor-step');
  await expect(rows).toHaveCount(2);
  for (const i of [0, 1]) {
    await expect(rows.nth(i)).toHaveAttribute('data-state', 'finalized', { timeout: 30_000 });
    await expect(rows.nth(i).locator('.hash__value')).toHaveText(/^0x[0-9a-f]{4}…[0-9a-f]{4}$/);
  }
  const audit = page.getByTestId('audit-key');
  await expect(audit).toContainText('Audit key · shown once');
  await expect(
    audit.getByRole('button', { name: /^Copy audit key 0x[0-9a-f]{64}$/ }),
  ).toBeVisible();
  await audit.getByRole('link', { name: 'Open Mumbai Arrivals e2e' }).click();
  await page.waitForURL(/\/sponsor\/0x[0-9a-f]{64}$/);
  await expect(page.getByTestId('sponsor-claims')).toHaveText('0 claims');
  await expect(page.locator('.sponsor-hero__line')).toContainText(
    '$0.00 of $50.00 · 10 cap · 10/h',
  );
  // no KPI tile wall, no donut: tables
  await expect(page.getByRole('table')).toHaveCount(3);
  const url = page.url();

  // pause via slide-to-confirm: a gesture, not a value (RT-W-04) — ten deliberate → presses, then the release
  const slider = page.getByTestId('slide-to-confirm');
  await slider.focus();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight', { delay: 40 });
  const action = page.locator('.onchain-action').last();
  await expect(action).toHaveAttribute('data-state', 'finalized', { timeout: 30_000 });
  await expect(page.locator('.pill')).toHaveText('Paused');
  await expect(page.getByRole('button', { name: 'Resume claims' })).toBeVisible();
  await page.goto(url);
  await expect(page.locator('.pill')).toHaveText('Paused');
});

test("sponsor table lists HMAC'd claim keys only (no nullifier-looking values beyond keys)", async ({
  page,
}) => {
  // a claim on the suite's campaign, then the sponsor's view of it
  await claimFreeBundle(page);
  const plans = await apiGet<PlansResponse>(page, '/plans');
  const campaignId = plans.campaign?.id ?? '';
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/sponsor/${campaignId}`);
  const table = page.getByTestId('claims-table');
  await expect(table.getByTestId('claim-row').first()).toBeVisible({ timeout: 20_000 });
  const keys = await table.locator('tbody tr td:nth-child(2) .hash__value').allTextContents();
  for (const k of keys) expect(k).toMatch(/^0x[0-9a-f]{4}…[0-9a-f]{4}$/);
  const text = await table.innerText();
  expect(text).not.toMatch(/\b\d{40,}\b/); // no decimal World nullifiers
  expect(text).not.toMatch(/ent:v1:/); // no entitlement keys
  await expect(page.getByRole('button', { name: "Export claims CSV (HMAC'd keys)" })).toBeVisible();
});
