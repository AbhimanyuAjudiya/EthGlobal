// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppHeader, WalletControl, type WalletControlProps } from '../components/Shell';
import { EvmWalletGuidance, Wallets } from '../components/Wallets';

const ADDRESS = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';

function control(props: Partial<WalletControlProps> = {}) {
  const handlers = { onConnect: vi.fn(), onDisconnect: vi.fn() };
  render(<WalletControl mounted {...handlers} {...props} />);
  return handlers;
}

describe('WalletControl (RainbowKit ConnectButton.Custom render)', () => {
  it('not connected: one compact Connect button that opens the modal', () => {
    const h = control();
    fireEvent.click(screen.getByRole('button', { name: 'Connect EVM' }));
    expect(h.onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('before hydration the button is there but inert', () => {
    control({ mounted: false });
    expect(screen.getByText('Connect EVM').closest('button')?.disabled).toBe(true);
  });

  it('connected: the ENS name or shortened address, the full address on hover; Disconnect behind it', () => {
    const h = control({ account: { address: ADDRESS, displayName: '0x99…A4dc' } });
    const toggle = screen.getByRole('button', { name: '0x99…A4dc' });
    expect(screen.getByTitle(ADDRESS).textContent).toBe('0x99…A4dc');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'Connected' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Switch to/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(h.onDisconnect).toHaveBeenCalledOnce();
  });

  it('names the wallet’s network neutrally: no warning, no global switch (each action switches for itself)', () => {
    control({ account: { address: ADDRESS, displayName: 'rahul.eth' }, network: 'Base Sepolia' });
    fireEvent.click(screen.getByRole('button', { name: 'rahul.eth' }));
    expect(screen.getByText('Network · Base Sepolia')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: /Switch to/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });
});

describe('the header carries the one wallet control (wagmi + RainbowKit providers)', () => {
  it('renders the connect state once mounted, with no wallet connected', async () => {
    render(
      <Wallets>
        <AppHeader />
      </Wallets>,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect EVM' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
  });

  it('directs native HashPack users to native Hedera checkout', () => {
    render(<EvmWalletGuidance />);
    const guidance = screen.getByTestId('evm-wallet-guidance');
    expect(guidance.textContent).toContain('EVM accounts');
    expect(guidance.textContent).toContain('Ed25519');
    expect(guidance.textContent).toContain('checkout → Hedera → Pay with HashPack');
    expect(guidance.textContent).toContain('new plans and top-ups');
    expect(screen.getByRole('link', { name: 'Pay with native Hedera' }).getAttribute('href')).toBe(
      '/pay',
    );
  });
});
