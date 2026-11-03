// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PrintSheet, type PrintCard } from './PrintSheet';

const printCss = readFileSync(path.join(import.meta.dirname, '../../print.css'), 'utf8');

const PINS = ['4821993011275064', '2950595390095615', '4176728488628584'];
const cards = (n: number): PrintCard[] =>
  Array.from({ length: n }, (_, i) => ({
    mb: 300,
    sponsor: 'Hedera',
    pin: PINS[i % PINS.length] ?? '4821993011275064',
    serial: `7f3a00${String(i).padStart(2, '0')}`,
    sponsorPaid: '$0.50',
  }));

describe('print.css', () => {
  it('matches the reviewed snapshot', () => {
    expect(printCss).toMatchSnapshot();
  });

  it('sets A4 sheets and the 91.6 × 59.98 mm single-card page with zero margins', () => {
    expect(printCss).toMatch(/@page\s*\{\s*size: A4 portrait;\s*margin: 0;/);
    expect(printCss).toMatch(/@page coupon-single\s*\{\s*size: 91\.6mm 59\.98mm;\s*margin: 0;/);
    expect(printCss).toContain('--trim-w: 85.6mm');
    expect(printCss).toContain('--trim-h: 53.98mm');
    expect(printCss).toContain('print-color-adjust: exact');
  });

  it('never prints below 7 pt and keeps the PIN at 11 pt', () => {
    const sizes = [...printCss.matchAll(/font-size:\s*([\d.]+)pt/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(7);
    expect(printCss).toMatch(/\.coupon__pin \{[^}]*font-size: 11pt/);
  });

  it('fits 5 rows of cards plus bleed and marks inside the sheet height', () => {
    const mm = (name: string) => Number(new RegExp(`--${name}: ([\\d.]+)mm`).exec(printCss)?.[1]);
    const rows = 5 * mm('trim-h') + 4 * mm('gutter');
    const margin = (mm('sheet-h') - rows) / 2;
    expect(margin).toBeGreaterThanOrEqual(mm('bleed') + mm('mark-gap') + mm('mark-len'));
    expect(2 * mm('trim-w') + mm('gutter') + 2 * mm('bleed')).toBeLessThan(mm('sheet-w'));
    expect(mm('sheet-h')).toBeLessThan(297);
  });

  it('hides the screen-only latex layers in the print variant', () => {
    expect(printCss).toMatch(/\.coupon\[data-variant='print'\] canvas/);
    expect(printCss).toMatch(/\.coupon\[data-variant='print'\] \.scratch__latex/);
  });
});

describe('PrintSheet', () => {
  it('puts ten print-variant coupons on one A4 sheet with perimeter crop marks', () => {
    const { container } = render(<PrintSheet cards={cards(10)} />);
    expect(container.querySelectorAll('.print-sheet')).toHaveLength(1);
    expect(container.querySelectorAll('.coupon[data-variant="print"]')).toHaveLength(10);
    // 2 columns × 2 edges × top/bottom + 5 rows × 2 edges × left/right
    expect(container.querySelectorAll('.print-mark')).toHaveLength(28);
    expect(container.textContent).toContain('4821 9930 1127 5064');
    expect(container.textContent).toContain('क्योंकि आप इंसान हैं');
  });

  it('starts a new sheet after ten cards', () => {
    const { container } = render(<PrintSheet cards={cards(11)} />);
    expect(container.querySelectorAll('.print-sheet')).toHaveLength(2);
  });

  it('mirrors backs per row for long-edge duplex and prints the receipt and ENS write-in', () => {
    const { container } = render(<PrintSheet cards={cards(3)} side="back" />);
    const serials = [...container.querySelectorAll('.print-back__serial')].map(
      (n) => n.textContent,
    );
    expect(serials).toEqual(['7f3a0001', '7f3a0000', '7f3a0002']);
    const cells = container.querySelectorAll('.print-cell');
    expect(cells[2]?.childElementCount).toBe(0); // the odd card sits in the right-hand cell
    expect(container.textContent).toContain('Paid by Hedera');
    expect(container.textContent).toContain(
      '.eth — write a name to gift this card, or redeem at /card',
    );
  });

  it('single layout gives every card its own page and no crop marks', () => {
    const { container } = render(<PrintSheet cards={cards(2)} layout="single" />);
    expect(container.querySelectorAll('.print-sheet[data-layout="single"]')).toHaveLength(2);
    expect(container.querySelectorAll('.print-mark')).toHaveLength(0);
  });

  it('renders the keyline side from the same markup', () => {
    const { container } = render(<PrintSheet cards={cards(1)} side="keyline" />);
    expect(
      container.querySelector('.print-sheet[data-side="keyline"] .coupon__panel'),
    ).not.toBeNull();
  });
});
