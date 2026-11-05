// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { announce, coinbase, ICON, install, metamask } from './eip6963';
import { WalletButton } from '../components/Shell';
import { rememberInjected, type Announced } from '../lib/wallet';

const connect = vi.fn<(choice?: Announced) => void>();
const button = () =>
  render(<WalletButton wallet={undefined} busy={false} error={undefined} onInjected={connect} />);
let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  sessionStorage.clear();
  connect.mockClear();
});

describe('WalletButton', () => {
  it('two wallets: "Choose a wallet" opens a picker with each icon and name; a pick connects that provider only', () => {
    uninstall = install(metamask, coinbase);
    button();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a wallet' }));
    const rows = within(screen.getByRole('group', { name: 'Choose a wallet' })).getAllByRole(
      'button',
    );
    expect(rows.map((b) => b.textContent)).toEqual(['MetaMask', 'Coinbase Wallet']);
    expect(rows.map((b) => b.querySelector('img')?.getAttribute('src'))).toEqual([ICON, ICON]);
    fireEvent.click(screen.getByRole('button', { name: 'Coinbase Wallet' }));
    expect(connect).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0]?.[0]?.provider).toBe(coinbase.provider);
  });

  it('one wallet: named on the button and connected directly', () => {
    uninstall = install(metamask);
    button();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with MetaMask' }));
    expect(connect).toHaveBeenCalledWith(metamask);
  });

  it('none: the generic line; the tap leaves discovery (and window.ethereum) to the hook', () => {
    button();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Coinbase Wallet / MetaMask' }),
    );
    expect(connect).toHaveBeenCalledWith(undefined);
  });

  it('a wallet announcing late turns the named button into the picker', () => {
    uninstall = install(metamask);
    button();
    screen.getByRole('button', { name: 'Continue with MetaMask' });
    act(() => {
      announce(coinbase);
    });
    screen.getByRole('button', { name: 'Choose a wallet' });
  });

  it('the wallet chosen earlier in the tab is offered by name, without the picker', () => {
    uninstall = install(metamask, coinbase);
    rememberInjected('com.coinbase.wallet');
    button();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Coinbase Wallet' }));
    expect(connect).toHaveBeenCalledWith(coinbase);
  });

  it('an icon that is not a data: URI is never rendered', () => {
    uninstall = install(
      { ...metamask, info: { ...metamask.info, icon: 'https://evil.example/x.png' } },
      coinbase,
    );
    button();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a wallet' }));
    expect(screen.getByRole('button', { name: 'MetaMask' }).querySelector('img')).toBeNull();
  });
});
