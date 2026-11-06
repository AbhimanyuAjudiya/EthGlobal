import { API_URL, RPC_URL } from './env';
import { expect, test } from './fixtures';

const DAY_MS = 86_400_000;

/**
 * Runs LAST (project "clock"): it moves the API's local clock (POST /__local/clock, MODE=local only) and Anvil's
 * time forward past a gift's claimBy, so nothing after it may rely on wall-clock agreement.
 */
test('gift: reclaim after claimBy (clock mocked via API seed) → refund receipt row', async ({
  page,
}) => {
  await page.goto('/gift');
  await page.getByTestId('gift-name').fill('rahul.eth');
  await expect(page.getByTestId('gift-resolution')).toHaveText(/resolves/);
  await page
    .locator('.onchain-action')
    .getByRole('button', { name: 'Gift 1 GB to rahul.eth · $4.00' })
    .click();
  await expect(page.getByTestId('gift-result')).toBeVisible({ timeout: 20_000 });
  // the Reclaim list lives on /gift/claim
  await page.goto('/gift/claim');
  const row = page.getByTestId('reclaim-row').first();
  await expect(
    row.getByRole('button', { name: 'Reclaim opens after the claim window closes' }),
  ).toBeDisabled();

  // seven days and a second later, for the API and for the chain
  const advance = 7 * DAY_MS + 60_000; // past claimBy even on the page's 30-s clock tick
  const moved = await page.request.post(`${API_URL}/__local/clock`, {
    data: { advanceMs: advance },
    headers: { 'x-forwarded-for': '198.18.9.9' },
  });
  expect(moved.ok()).toBe(true);
  for (const [method, params] of [
    ['evm_increaseTime', [Math.ceil(advance / 1000)]],
    ['evm_mine', []],
  ] as const)
    await page.request.post(RPC_URL, { data: { jsonrpc: '2.0', id: 1, method, params } });
  // the browser follows the API's clock (earlier runs may have moved it already)
  const { now } = (await moved.json()) as { now: number };
  await page.clock.install({ time: now });
  await page.reload();

  const reclaim = page
    .getByTestId('reclaim-row')
    .first()
    .getByRole('button', { name: 'Reclaim the USDC' });
  await expect(reclaim).toBeEnabled();
  await reclaim.click();
  await expect(page.getByTestId('reclaim-row').first()).toContainText('Refunded $4.00', {
    timeout: 20_000,
  });
  // a refunded row opens its receipt in a Sheet
  await page.getByTestId('reclaim-row').first().getByRole('button').first().click();
  await expect(page.getByRole('dialog').locator('.receipt')).toContainText('You');
});
