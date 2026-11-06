// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppHeader, WalletControl, type WalletControlProps } from '../components/Shell';
import { Wallets } from '../components/Wallets';

const ADDRESS = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';

function control(props: Partial<WalletControlProps> = {}) {
  const handlers = { onConnect: vi.fn(), onSwitchNetwork: vi.fn(), onDisconnect: vi.fn() };
  render(<WalletControl mounted {...handlers} {...props} />);
  return handlers;
}

describe('WalletControl (RainbowKit ConnectButton.Custom render)', () => {
  it('not connected: one compact Connect button that opens the modal', () => {
    const h = control();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(h.onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('before hydration the button is there but inert', () => {
    control({ mounted: false });
    expect(screen.getByText('Connect').closest('button')?.disabled).toBe(true);
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

  it('wrong network: names where the wallet is and switches to the app chain', () => {
    const h = control({
      account: { address: ADDRESS, displayName: 'rahul.eth' },
      wrongNetwork: { have: 'Hedera EVM', want: 'Base' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'rahul.eth' }));
    expect(screen.getByRole('status').textContent).toBe('Wallet is on Hedera EVM');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Base' }));
    expect(h.onSwitchNetwork).toHaveBeenCalledOnce();
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
      expect(screen.getByRole('button', { name: 'Connect' }).hasAttribute('disabled')).toBe(false),
    );
  });
});
