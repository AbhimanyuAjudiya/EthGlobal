import { BASE_URL, PRINT_TOKEN } from './env';
import { expect, state, test } from './fixtures';

/** Pages in a Chromium PDF: one /Type /Page object per page. */
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test.describe('/print/cards (T-64)', () => {
  test('/print/cards without token → 404, wrong token → 404, noindex', async ({ request }) => {
    expect((await request.get(`${BASE_URL}/print/cards`)).status()).toBe(404);
    const wrong = await request.get(`${BASE_URL}/print/cards?token=nope-nope-nope-nope`);
    expect(wrong.status()).toBe(404);
    expect(await wrong.text()).not.toMatch(/\d{4} \d{4} \d{4} \d{4}/);
  });

  test('with token → N coupons, PINs in Chivo Mono, PDF renders without clipping (page count = N + 1 keyline)', async ({
    page,
  }) => {
    const cards = state().cards;
    const res = await page.goto(`/print/cards?token=${PRINT_TOKEN}`, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
    expect(res?.headers()['x-robots-tag']).toContain('noindex');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.emulateMedia({ media: 'print' });
    const coupons = page.locator('.print-sheet[data-side="front"] .coupon[data-variant="print"]');
    await expect(coupons).toHaveCount(cards.length);
    const pins = (await page.locator('.print-sheet[data-side="front"] .coupon__pin').allTextContents()).map((t) =>
      t.replace(/^PIN /, '').trim(),
    );
    expect(pins).toEqual(cards.map((c) => c.pin.replace(/(\d{4})(?=\d)/g, '$1 ')));
    const font = await page.locator('.coupon__pin').first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toContain('Chivo Mono');
    await expect(page.locator('.print-sheet[data-side="front"] svg.qr-code')).toHaveCount(cards.length);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('.print-sheet')].flatMap((sheet) => {
        const s = sheet.getBoundingClientRect();
        return [...sheet.querySelectorAll('.coupon__pin, .qr-code')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < s.left - 0.5 || r.top < s.top - 0.5 || r.right > s.right + 0.5 || r.bottom > s.bottom + 0.5;
        }).length;
      }),
    );
    expect(clipped.every((n) => n === 0)).toBe(true);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pageCount(pdf)).toBe(cards.length + 1);
  });
});
