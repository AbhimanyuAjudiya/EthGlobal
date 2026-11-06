// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { isStuck, OnchainAction, type OnchainActionProps } from './OnchainAction';
import { onchainActionStates } from '../../index';

const HASH = '0x1a2b80f6cd88a88474e7c4db5d3de758f33eeaf3368b639ab1f4681d81789f3e';
const NEW_HASH = '0x5e6fe132e373afa7b6cf8061d0353ace8676fa2196e64b2e67c27486eed4a1b2';
const common = {
  title: 'Add 100 MB · $0.40',
  review: [{ label: 'Network fee', value: '$0.00 — paid by the facilitator' }],
  worstCase: 'Worst case: if settlement fails you pay nothing. This approval expires in 5:00',
  network: 'Hedera',
  explorerUrl: 'https://hashscan.io/testnet/transaction/{hash}',
  explorerName: 'HashScan',
} as const;

/** One representative prop set per state; the gallery renders the same eight. */
const byState: Record<(typeof onchainActionStates)[number], OnchainActionProps> = {
  idle: { ...common, state: 'idle', actionLabel: 'Pay $0.40 USDC' },
  signing: {
    ...common,
    state: 'signing',
    walletName: 'MetaMask',
    simulation: '0.40 USDC leaves your account; 100 MB arrives',
  },
  submitted: { ...common, state: 'submitted', hash: HASH, elapsedMs: 4000, expectedMs: 5000 },
  pending: { ...common, state: 'pending', hash: HASH, elapsedMs: 6000, expectedMs: 5000 },
  confirmed: {
    ...common,
    state: 'confirmed',
    hash: HASH,
    result: '+100 MB · settled · 400 MB total',
    balances: { available: '300 MB', pending: '100 MB' },
  },
  finalized: { ...common, state: 'finalized', hash: HASH, result: '+100 MB · 400 MB total' },
  failed: {
    ...common,
    state: 'failed',
    reason: 'the facilitator rejected the signature (expired)',
  },
  replaced: {
    ...common,
    state: 'replaced',
    hash: HASH,
    replacement: { hash: NEW_HASH, kind: 'speed-up' },
  },
};

const statusText = () => screen.getByRole('status').textContent ?? '';

describe('OnchainAction', () => {
  it.each(onchainActionStates)(
    '%s: a labelled receipt sheet with a live status region',
    (state) => {
      const { container } = render(<OnchainAction {...byState[state]} />);
      expect(screen.getByRole('region', { name: 'Add 100 MB · $0.40' })).toBeTruthy();
      expect(container.querySelector('.onchain-action')?.getAttribute('data-state')).toBe(state);
      expect(screen.getByRole('status')).toBeTruthy();
      expect(container.textContent).not.toMatch(/Something went wrong|Success!|!/);
    },
  );

  it('shows the hash first in submitted, never before', () => {
    for (const state of ['idle', 'signing'] as const) {
      const { container, unmount } = render(<OnchainAction {...byState[state]} />);
      expect(container.querySelector('[data-hash]')).toBeNull();
      unmount();
    }
    render(<OnchainAction {...byState.submitted} />);
    expect(statusText()).toContain('Sending · 0x1a2b…9f3e');
    expect(statusText()).toContain('4 s');
  });

  it.each(['submitted', 'pending', 'confirmed', 'finalized', 'replaced'] as const)(
    '%s: every 0x value has a copy button and an explorer link',
    (state) => {
      const { container } = render(<OnchainAction {...byState[state]} />);
      const values = container.querySelectorAll('[data-hash]');
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        const full = value.getAttribute('title') ?? '';
        expect(screen.getByRole('button', { name: new RegExp(`^Copy .* ${full}$`) })).toBeTruthy();
      }
      const links = screen.getAllByRole('link', { name: 'HashScan' });
      expect(links[0]?.getAttribute('href')).toBe(
        `https://hashscan.io/testnet/transaction/${HASH}`,
      );
      expect(links[0]?.getAttribute('rel')).toBe('noreferrer');
    },
  );

  it('copies the full value to the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<OnchainAction {...byState.submitted} />);
    fireEvent.click(screen.getByRole('button', { name: `Copy transaction hash ${HASH}` }));
    expect(writeText).toHaveBeenCalledWith(HASH);
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('idle: review lines, worst case, the amount on the button', () => {
    const onConfirm = vi.fn();
    render(
      <OnchainAction {...common} state="idle" actionLabel="Pay $0.40 USDC" onConfirm={onConfirm} />,
    );
    expect(screen.getByText('$0.00 — paid by the facilitator')).toBeTruthy();
    expect(screen.getByText(common.worstCase)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pay $0.40 USDC' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('idle after a wallet rejection is neutral; a failed pre-flight keeps the wallet shut', () => {
    const { rerender } = render(
      <OnchainAction
        {...common}
        state="idle"
        actionLabel="Pay $0.40 USDC"
        declined
        walletName="MetaMask"
      />,
    );
    expect(statusText()).toBe('You declined in MetaMask. Nothing was sent.');
    rerender(
      <OnchainAction
        {...common}
        state="idle"
        actionLabel="Pay $0.40 USDC"
        blocked="Hedera account has 0.12 USDC."
      />,
    );
    expect(screen.getByRole('button', { name: 'Pay $0.40 USDC' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('signing: "Approve in MetaMask…", what leaves and arrives, cancel', () => {
    const onCancel = vi.fn();
    render(
      <OnchainAction
        {...common}
        state="signing"
        walletName="MetaMask"
        simulation="0.40 USDC leaves your account; 100 MB arrives"
        onCancel={onCancel}
      />,
    );
    expect(statusText()).toBe('Approve in MetaMask…');
    expect(screen.getByText('0.40 USDC leaves your account; 100 MB arrives')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('raises the stuck flag after 2× the expected time, in the same row', () => {
    expect(isStuck('pending', 10_000, 5000)).toBe(false);
    expect(isStuck('pending', 10_001, 5000)).toBe(true);
    expect(isStuck('confirmed', 60_000, 5000)).toBe(false);
    render(
      <OnchainAction
        {...common}
        state="pending"
        hash={HASH}
        elapsedMs={12_000}
        expectedMs={5000}
      />,
    );
    expect(screen.getByText(/Slower than usual: 12 s, usually 5 s/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Speed up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel transaction' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirmed: result with a quiet settling tag, available and pending apart', () => {
    render(<OnchainAction {...byState.confirmed} />);
    expect(screen.getByText('settling')).toBeTruthy();
    expect(screen.getByText(/\+100 MB · settled · 400 MB total/)).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('finalized: "Paid · Final" as metadata', () => {
    render(<OnchainAction {...byState.finalized} />);
    expect(statusText()).toMatch(/^Paid · Final · Hedera/);
  });

  it('failed: decoded reason in plain words and the honest fee note', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <OnchainAction
        {...common}
        state="failed"
        reason="the facilitator rejected the signature (expired)"
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByText(
        "Didn't go through: the facilitator rejected the signature (expired). Nothing left your account.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(
      <OnchainAction
        {...common}
        state="failed"
        reason="the gift escrow is paused"
        feeCharged="$0.01"
        hash={HASH}
      />,
    );
    expect(
      screen.getByText(
        "Didn't go through: the gift escrow is paused. Nothing left your account except the $0.01 network fee.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: `Copy transaction hash ${HASH}` })).toBeTruthy();
  });

  it('replaced: both hashes copyable; cancel names the fee', () => {
    const { container, rerender } = render(<OnchainAction {...byState.replaced} />);
    expect(screen.getByRole('button', { name: `Copy replacement hash ${NEW_HASH}` })).toBeTruthy();
    expect(within(container).getByText(/Sped up with a replacement/)).toBeTruthy();
    rerender(
      <OnchainAction
        {...common}
        state="replaced"
        hash={HASH}
        replacement={{ hash: NEW_HASH, kind: 'cancel' }}
        feeCharged="$0.01"
      />,
    );
    expect(statusText()).toMatch(/^Cancelled/);
    expect(screen.getByText(/Only the \$0.01 network fee was charged/)).toBeTruthy();
  });
});
