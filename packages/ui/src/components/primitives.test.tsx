// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Field } from './Field';
import { Hash } from './Hash';
import { Receipt } from './Receipt';

describe('Button', () => {
  it('defaults to a primary type="button" and forwards props', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Pay $0.40 USDC</Button>);
    const button = screen.getByRole('button', { name: 'Pay $0.40 USDC' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('data-variant')).toBe('primary');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('variants and disabled', () => {
    render(
      <>
        <Button variant="quiet">Later</Button>
        <Button disabled>Pay</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Later' }).getAttribute('data-variant')).toBe(
      'quiet',
    );
    expect(screen.getByRole('button', { name: 'Pay' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('Field', () => {
  it('labels the input and wires hint and error', () => {
    render(
      <Field label="Coupon PIN" hint="16 digits" error="That PIN fails its check digit." mono />,
    );
    const input = screen.getByLabelText('Coupon PIN');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toHaveLength(2);
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      '16 digits',
      'That PIN fails its check digit.',
    ]);
    expect(input.className).toContain('ui-field__input--mono');
  });

  it('is valid and undescribed by default', () => {
    render(<Field label="Who gets it?" />);
    const input = screen.getByRole('textbox', { name: 'Who gets it?' });
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('Hash', () => {
  it('shows the short form, keeps the full value, and links out only when given a URL', () => {
    const value = '0x1a2b80f6cd88a88474e7c4db5d3de758f33eeaf3368b639ab1f4681d81789f3e';
    const { rerender } = render(<Hash value={value} kind="address" />);
    expect(screen.getByText('0x1a2b…9f3e').getAttribute('title')).toBe(value);
    expect(screen.getByRole('button', { name: `Copy address ${value}` })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    rerender(
      <Hash value={value} explorerHref={`https://x.test/${value}`} explorerName="Basescan" />,
    );
    expect(screen.getByRole('link', { name: 'Basescan' }).getAttribute('target')).toBe('_blank');
  });

  it('says so when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<Hash value="0x1234567890abcdef1234" />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Select to copy')).toBeTruthy();
  });
});

describe('Receipt', () => {
  it('is three ruled lines: you / sponsor / network fee', () => {
    render(
      <Receipt
        heading="+100 MB · Sat 7 Nov 03:12 · Hedera · Final"
        you="$0.40"
        networkFee="$0.00"
      />,
    );
    expect(screen.getByRole('region', { name: 'Receipt' })).toBeTruthy();
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual([
      'You',
      'Sponsor',
      'Network fee',
    ]);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '$0.40',
      '—',
      '$0.00',
    ]);
  });

  it('relabels for the printed card and tints only the failed amount', () => {
    const { container } = render(
      <Receipt
        labels={{ you: 'Bundle', sponsor: 'Paid by Hedera' }}
        you="300 MB"
        sponsor="$0.50"
        networkFee="$0.00"
        failed
      />,
    );
    expect(screen.getByText('Paid by Hedera')).toBeTruthy();
    const tones = [...container.querySelectorAll('.ruled__row')].map((r) =>
      r.getAttribute('data-tone'),
    );
    expect(tones).toEqual(['negative', null, null]);
  });
});
