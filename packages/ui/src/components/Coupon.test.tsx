// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Coupon } from './Coupon';

const NOW = Date.UTC(2026, 10, 8, 8, 32); // 14:02 IST
const PIN = '4821993011275064';
const norm = (text: string | null | undefined) => (text ?? '').replace(/\u00a0/g, ' ');

describe('Coupon', () => {
  it('reads "300 MB · from <sponsor> · because you\'re human" as one line', () => {
    const { container } = render(<Coupon mb={300} sponsor="Hedera" />);
    const headline = container.querySelector('.coupon__headline');
    expect(norm(headline?.textContent)).toBe("300 MB · from Hedera · because you're human");
    expect(
      screen.getByRole('article', { name: 'Recharge coupon, 300 MB, from Hedera' }),
    ).toBeTruthy();
  });

  it('sets the amount at 2× everything else (64 px value against ≤ 32 px)', () => {
    const { container } = render(<Coupon mb={300} sponsor="Hedera" />);
    expect(container.querySelector('.coupon__value')?.textContent).toBe('300');
    expect(container.querySelector('.coupon__unit')?.textContent).toBe('MB');
  });

  it('prints the PIN 4-4-4-4 in the mono layer and the usage line in en-IN 24-hour time', () => {
    const { container } = render(<Coupon mb={300} sponsor="Hedera" pin={PIN} usageAsOf={NOW} />);
    const pin = container.querySelector('.coupon__pin');
    expect(pin?.hasAttribute('data-hash')).toBe(true);
    expect(pin?.textContent).toBe('PIN 4821 9930 1127 5064');
    expect(screen.getByText('usage as of 14:02')).toBeTruthy();
    expect(screen.getByText('usage as of 14:02').getAttribute('datetime')).toBe(
      new Date(NOW).toISOString(),
    );
  });

  it('Hindi: lang="hi", the §6 strings verbatim, numerals stay Latin', () => {
    const { container } = render(<Coupon mb={300} sponsor="Hedera" usageAsOf={NOW} lang="hi" />);
    expect(container.querySelector('.coupon')?.getAttribute('lang')).toBe('hi');
    expect(norm(container.querySelector('.coupon__headline')?.textContent)).toBe(
      '300 MB · Hedera की ओर से · क्योंकि आप इंसान हैं',
    );
    expect(screen.getByText('14:02 तक का उपयोग')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[०-९]/); // no Devanagari digits
  });

  it('notification variant is two lines', () => {
    const { container } = render(
      <Coupon mb={300} sponsor="Hedera" variant="notification" note="Install takes 2 minutes." />,
    );
    const lines = container.querySelectorAll('p');
    expect(lines).toHaveLength(2);
    expect(norm(lines[0]?.textContent)).toBe('300 MB · from Hedera');
    expect(lines[1]?.textContent).toBe("because you're human. Install takes 2 minutes.");
  });

  it('calls the QR render prop with the card URL at 22 mm and shows nothing without it', () => {
    const renderQr = vi.fn(() => <svg role="img" aria-label="qr" />);
    render(<Coupon mb={300} pin={PIN} qrUrl="https://x.test/card/7f3a0010" renderQr={renderQr} />);
    expect(renderQr).toHaveBeenCalledWith({
      url: 'https://x.test/card/7f3a0010',
      sizeMm: 22,
      label: 'QR code for https://x.test/card/7f3a0010',
    });
    expect(screen.getByRole('img', { name: 'qr' })).toBeTruthy();
  });

  it('print variant adds the Hindi reason and keeps the same data', () => {
    const { container } = render(<Coupon mb={300} pin={PIN} serial="7f3a0010" variant="print" />);
    expect(container.querySelector('.coupon')?.getAttribute('data-variant')).toBe('print');
    expect(container.querySelector('[lang="hi"]')?.textContent).toBe('क्योंकि आप इंसान हैं');
    expect(container.querySelector('.coupon__serial')?.textContent).toBe('7f3a0010');
  });

  it('stays paper-light in both themes and shows a status without dropping the amount', () => {
    const { container } = render(
      <Coupon mb={300} status="Sponsor bundles finished for today · next batch 09:00 IST" />,
    );
    expect(container.querySelector('.coupon')?.getAttribute('data-color-scheme')).toBe('light');
    expect(
      screen.getByText('Sponsor bundles finished for today · next batch 09:00 IST'),
    ).toBeTruthy();
    expect(container.querySelector('.coupon__value')?.textContent).toBe('300');
  });

  it('shows GB above 1000 MB and refuses a malformed PIN', () => {
    const { container } = render(<Coupon mb={1500} />);
    expect(norm(container.querySelector('.coupon__amount')?.textContent)).toBe('1.5 GB');
    expect(() => render(<Coupon mb={300} pin="1234" />)).toThrow('a PIN is 16 digits');
  });
});
