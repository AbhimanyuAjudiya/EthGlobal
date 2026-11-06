import { API_URL } from './env';
import { expect, state, test } from './fixtures';

/** Flip one digit and fix nothing: Verhoeff catches every single-digit typo. */
const typo = (pin: string) => `${pin.slice(0, 5)}${(Number(pin[5]) + 1) % 10}${pin.slice(6)}`;

test.describe('/card/[serial] — preview → scratch → redeem', () => {
  test('GET /card/[serial] never changes state (reload twice)', async ({ page }) => {
    const card = state().cards[0];
    if (!card) throw new Error('no seeded card');
    const previews: string[] = [];
    page.on('response', async (res) => {
      if (res.url() === `${API_URL}/card/${card.serial}`) previews.push(await res.text());
    });
    await page.goto(`/card/${card.serial}`);
    await expect(page.getByTestId('card-state')).toHaveText('300 MB · Not yet redeemed');
    await page.reload();
    await expect(page.getByTestId('card-state')).toHaveAttribute('data-state', 'open');
    await page.reload();
    await expect(page.getByTestId('card-state')).toHaveAttribute('data-state', 'open');
    expect(previews.length).toBeGreaterThanOrEqual(3);
    expect(new Set(previews).size).toBe(1);
    // never redeems on load, and the PIN is not on the page until typed
    await expect(page.getByTestId('card-redeem')).toHaveCount(0);
    expect(await page.content()).not.toContain(card.pin);
  });

  test('scratch to ≥ 45 % enables Redeem; typo PIN rejected locally (Verhoeff); valid → /plan', async ({
    page,
  }) => {
    const card = state().cards[1];
    if (!card) throw new Error('no seeded card');
    let redeemCalls = 0;
    page.on('request', (req) => {
      if (req.url() === `${API_URL}/card/redeem`) redeemCalls += 1;
    });
    await page.goto(`/card/${card.serial}`);
    await page.getByTestId('card-pin').fill(typo(card.pin));
    await page.getByRole('button', { name: 'Check PIN' }).click();
    await expect(page.getByText('That PIN has a typo — check the digits')).toBeVisible();
    expect(redeemCalls).toBe(0);

    await page.getByTestId('card-pin').fill(card.pin.replace(/(\d{4})(?=\d)/g, '$1 '));
    await page.getByRole('button', { name: 'Check PIN' }).click();
    const redeem = page.getByTestId('card-redeem');
    await expect(redeem).toBeDisabled();
    // scratch the latex with the pointer, 24 px brush, until the rest fades at 45 %
    const canvas = page.locator('.scratch canvas, canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.mouse.down();
    for (let y = 4; y < box.height; y += 16)
      for (const x of [4, box.width - 4]) await page.mouse.move(box.x + x, box.y + y, { steps: 6 });
    await page.mouse.up();
    await expect(redeem).toBeEnabled({ timeout: 5_000 });
    await redeem.click();
    await page.waitForURL(/\/plan\/.+/);
    await expect(page.locator('#plan-coupon .amount__value')).toHaveText('300');
    expect(redeemCalls).toBe(1);
  });

  test('the Reveal PIN button twin redeems without a pointer', async ({ page }) => {
    const card = state().cards[2];
    if (!card) throw new Error('no seeded card');
    await page.goto(`/card/${card.serial}`);
    await page.getByTestId('card-pin').fill(card.pin);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Reveal PIN' }).click();
    await page.getByTestId('card-redeem').click();
    await page.waitForURL(/\/plan\/.+/);
    // the card is spent: its preview now says so
    await page.goto(`/card/${card.serial}`);
    await expect(page.getByTestId('card-state')).toHaveAttribute('data-state', 'claimed');
  });
});
