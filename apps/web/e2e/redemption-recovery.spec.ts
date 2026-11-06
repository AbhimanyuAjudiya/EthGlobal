import { expect, interruptEntitlementOnce, state, storedLpas, test } from './fixtures';

test('free claim response loss recovers the same activation after reload and a new proof', async ({
  page,
}) => {
  const issuedKey = await interruptEntitlementOnce(page, '/claim');
  await page.goto('/verify');
  await page.getByRole('button', { name: 'Simulated World ID' }).click();
  await expect(page.getByTestId('claim-unconfirmed')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Simulated World ID' }).click();
  await page.waitForURL(/\/plan\/.+/);
  expect(decodeURIComponent(new URL(page.url()).pathname.slice('/plan/'.length))).toBe(issuedKey());
  await expect
    .poll(async () => (await storedLpas(page)).filter((value) => value.startsWith('LPA:')).length)
    .toBe(1);
});

test('a claimed scratch card can recover its interrupted activation on the original device', async ({
  page,
}) => {
  const card = state().cards[0];
  if (!card) throw new Error('no seeded card');
  const issuedKey = await interruptEntitlementOnce(page, '/card/redeem');
  await page.goto(`/card/${card.serial}`);
  await page.getByTestId('card-pin').fill(card.pin);
  await page.getByRole('button', { name: 'Check PIN' }).click();
  await page.getByRole('button', { name: 'Reveal PIN' }).click();
  await page.getByTestId('card-redeem').click();
  await expect(page.getByTestId('card-redeem')).toBeEnabled();
  await page.reload();
  await expect(page.getByTestId('card-state')).toHaveAttribute('data-state', 'claimed');
  await page.getByTestId('card-pin').fill(card.pin);
  await page.getByRole('button', { name: 'Check PIN' }).click();
  await page.getByRole('button', { name: 'Reveal PIN' }).click();
  await page.getByRole('button', { name: 'Recover activation' }).click();
  await page.waitForURL(/\/plan\/.+/);
  expect(decodeURIComponent(new URL(page.url()).pathname.slice('/plan/'.length))).toBe(issuedKey());
  await expect
    .poll(async () => (await storedLpas(page)).filter((value) => value.startsWith('LPA:')).length)
    .toBe(1);
});
