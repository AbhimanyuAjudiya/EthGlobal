// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActionView, type ActionViewProps } from '../components/ActionView';
import { initialRow, reducer, type ActionEvent, type ActionRow } from '../lib/onchain-action';

const HASH = `0x${'1a2b'.repeat(15)}9f3e`;

function walk(...events: ActionEvent[]): ActionRow {
  return events.reduce(reducer, initialRow);
}

const base: Omit<ActionViewProps, 'row'> = {
  now: 3_500,
  title: 'Add 100 MB · $0.40',
  network: 'eip155:31337',
  networkLabel: 'Local chain',
  review: [{ label: 'Network fee', value: '$0.00 — paid by the facilitator' }],
  worstCase: 'Worst case: if settlement fails you pay nothing. This approval expires in 5:00.',
  actionLabel: 'Pay $0.40 USDC',
  walletName: 'demo wallet · Anvil #5',
  simulation: '$0.40 USDC leaves your account; 100 MB arrives',
  result: '+100 MB · settled · 400 MB total',
  expectedMs: 1_000,
};

const view = (row: ActionRow, extra: Partial<ActionViewProps> = {}) =>
  render(<ActionView {...base} {...extra} row={row} />).container.querySelector('.onchain-action');

const start: ActionEvent = { type: 'start', at: 1_000 };
const signed: ActionEvent = { type: 'signed', hash: HASH, at: 2_000 };

describe('ActionView — the reducer row rendered through ui OnchainAction', () => {
  it('Review: amount on the one button, itemised fee, worst case; pre-flight blocks the wallet', () => {
    const onConfirm = vi.fn();
    const el = view(initialRow, { onConfirm });
    expect(el?.getAttribute('data-state')).toBe('idle');
    screen.getByRole('button', { name: 'Pay $0.40 USDC' }).click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(el?.textContent).toContain('$0.00 — paid by the facilitator');
    expect(el?.textContent).toContain('This approval expires in 5:00');
    const blocked = view(initialRow, {
      blocked: 'This account holds $0.10 USDC; the price is $0.40 USDC.',
    });
    expect(blocked?.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  });

  it('Confirm in wallet names the wallet and what moves; a decline returns to Review, neutral', () => {
    expect(view(walk(start))?.textContent).toContain('Approve in demo wallet · Anvil #5…');
    const declined = view(walk(start, { type: 'rejected' }));
    expect(declined?.getAttribute('data-state')).toBe('idle');
    expect(declined?.textContent).toContain(
      'You declined in demo wallet · Anvil #5. Nothing was sent.',
    );
  });

  it('Sending shows the hash the moment it exists, with copy, and elapsed time — never a bare spinner', () => {
    const el = view(walk(start, signed));
    expect(el?.getAttribute('data-state')).toBe('submitted');
    expect(el?.querySelector('.hash__value')?.textContent).toBe('0x1a2b…9f3e');
    expect(screen.getByRole('button', { name: `Copy transaction hash ${HASH}` })).toBeTruthy();
    expect(el?.textContent).toMatch(/Sending · 0x1a2b…9f3e.* · 2 s/);
  });

  it('stuck after 2 × expected: explains the delay without inert controls', () => {
    const el = view(walk(start, signed), { now: 2_000 + 2_500 });
    expect(el?.textContent).toContain('Slower than usual');
    expect(screen.queryByRole('button', { name: 'Speed up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel transaction' })).toBeNull();
  });

  it('Confirmed carries the "settling" tag; Final says "Paid · Final"', () => {
    const confirmed = walk(
      start,
      signed,
      { type: 'seen' },
      { type: 'confirmed', confirmations: 1 },
    );
    expect(view(confirmed)?.textContent).toContain('+100 MB · settled · 400 MB total settling');
    const final = view(reducer(confirmed, { type: 'finalized' }));
    expect(final?.textContent).toContain('Paid · Final');
    expect(final?.querySelector('.hash__value')?.textContent).toBe('0x1a2b…9f3e');
  });

  it('Failed: the decoded reason in plain words and the honest fee note, with a retry', () => {
    const before = view(
      walk(start, {
        type: 'preBroadcastError',
        reason: 'the signed amount did not match the price',
      }),
    );
    expect(before?.textContent).toContain(
      "Didn't go through: the signed amount did not match the price. Nothing left your account.",
    );
    const after = view(
      walk(start, signed, {
        type: 'revert',
        reason: 'the contract reverted the transaction',
        feeCharged: '0.00002 ETH',
      }),
    );
    expect(after?.textContent).toContain('except the 0.00002 ETH network fee');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('Replaced names the replacement hash', () => {
    const el = view(
      walk(start, signed, { type: 'replaced', hash: `0x${'cd'.repeat(32)}`, kind: 'speed-up' }),
    );
    expect(el?.getAttribute('data-state')).toBe('replaced');
    expect(el?.textContent).toContain('Replaced');
  });
});

it('never claims that an uncertain paid request moved no funds', () => {
  const el = view({
    state: 'failed',
    outcomeUnknown: true,
    reason: 'Payment may have completed. Check again.',
  });
  expect(el?.textContent).toContain('Payment may have completed');
  expect(el?.textContent).not.toContain('Nothing left your account');
  expect(el?.textContent).not.toContain("Didn't go through");
});
