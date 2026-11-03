import { expect, test } from '@playwright/test';

import { pdfPageCount, pdfText } from './pdf-text';

const PIN = /^\d{4} \d{4} \d{4} \d{4}$/;
/** A4 in PostScript points (Chromium rounds 595.28 × 841.89 to the CSS-pixel grid). */
const A4 = { w: 595.28, h: 841.89 };

test.describe('print sheet: /ui/print?count=10', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ui/print?count=10', { waitUntil: 'networkidle' });
    // fonts.css loads from Google with display=swap; wait so no fallback face is rasterised.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.emulateMedia({ media: 'print' });
  });

  test('ten cards render to exactly one A4 page with every PIN present as PDF text', async ({
    page,
  }) => {
    const pins = (await page.locator('.coupon__pin').allTextContents()).map((t) =>
      t.replace(/^PIN /, '').trim(),
    );
    expect(pins).toHaveLength(10);
    for (const pin of pins) expect(pin).toMatch(PIN);
    expect(new Set(pins).size).toBe(10);

    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdfPageCount(pdf)).toBe(1);

    const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
    expect(Math.abs(Number(box?.[1]) - A4.w)).toBeLessThan(1.5);
    expect(Math.abs(Number(box?.[2]) - A4.h)).toBeLessThan(1.5);

    // The 34 mm scratch panel sets each PIN as two lines of two groups; both must be real text.
    const text = pdfText(pdf).join('\n');
    for (const pin of pins) {
      const [a, b, c, d] = pin.split(' ');
      expect(text, pin).toContain(`${a} ${b}`);
      expect(text, pin).toContain(`${c} ${d}`);
    }
  });

  test('nothing is clipped: every card, PIN and crop mark sits inside the sheet', async ({
    page,
  }) => {
    const report = await page.evaluate(() => {
      const sheet = document.querySelector('.print-sheet');
      if (!sheet) return { ok: false, why: 'no sheet', issues: [] as string[] };
      const s = sheet.getBoundingClientRect();
      const issues: string[] = [];
      const inside = (el: Element, label: string) => {
        const r = el.getBoundingClientRect();
        if (
          r.left < s.left - 0.5 ||
          r.top < s.top - 0.5 ||
          r.right > s.right + 0.5 ||
          r.bottom > s.bottom + 0.5
        ) {
          issues.push(label);
        }
      };
      document.querySelectorAll('.print-cell').forEach((el, i) => inside(el, `cell ${i}`));
      document.querySelectorAll('.print-mark').forEach((el, i) => inside(el, `mark ${i}`));
      document.querySelectorAll('.coupon__pin').forEach((pin, i) => {
        const panel = pin.closest('.coupon__panel');
        if (!panel) return;
        const p = panel.getBoundingClientRect();
        const r = pin.getBoundingClientRect();
        if (r.left < p.left || r.right > p.right || r.top < p.top || r.bottom > p.bottom) {
          issues.push(`pin ${i} overflows its 34 × 12 mm panel`);
        }
        if (pin.scrollWidth > pin.clientWidth + 1) issues.push(`pin ${i} is cut`);
      });
      return { ok: true, why: '', issues };
    });
    expect(report.ok, report.why).toBe(true);
    expect(report.issues).toEqual([]);
  });

  test('the PIN prints in Chivo Mono at 11 pt and nothing prints below 7 pt', async ({ page }) => {
    const sizes = await page.evaluate(() => {
      const pin = document.querySelector('.coupon__pin');
      const style = pin ? getComputedStyle(pin) : undefined;
      const all = [...document.querySelectorAll('.print-sheet *')]
        .filter((el) => !el.closest('svg')) // SVG text is in user units (the QR slot), not CSS points
        .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()))
        .map((el) => parseFloat(getComputedStyle(el).fontSize));
      return {
        pinPx: parseFloat(style?.fontSize ?? '0'),
        family: style?.fontFamily ?? '',
        minPx: Math.min(...all),
      };
    });
    const pt = (px: number) => (px * 72) / 96;
    expect(pt(sizes.pinPx)).toBeCloseTo(11, 1);
    expect(sizes.family).toContain('Chivo Mono');
    expect(pt(sizes.minPx)).toBeGreaterThanOrEqual(7 - 0.01);
  });
});
