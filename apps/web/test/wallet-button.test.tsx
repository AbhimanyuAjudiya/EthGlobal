// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { announce, coinbase, ICON, install, metamask } from './eip6963';
import { WalletButton } from '../components/Shell';
import { useWallet } from '../lib/hooks';
import { rememberInjected, type Announced } from '../lib/wallet';

const connect = vi.fn<(choice?: Announced) => void>();
const button = () =>
  render(
    <WalletButton
      wallet={undefined}
      busy={false}
      error={undefined}
      onInjected={connect}
      onDisconnect={vi.fn()}
    />,
  );
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

/** An extension that emits EIP-1193 events, wired through the real useWallet hook. */
function eventful(name: string, rdns: string, accounts: string[]) {
  const listeners = new Map<string, Set<(arg: unknown) => void>>();
  const request = vi.fn(({ method }: { method: string }) =>
    Promise.resolve(
      method === 'eth_chainId' ? '0x14a34' : method === 'eth_requestAccounts' ? accounts : null,
    ),
  );
  const w: Announced = {
    info: { name, rdns, icon: ICON },
    provider: {
      request,
      on: (e, l) => void listeners.set(e, (listeners.get(e) ?? new Set()).add(l)),
      removeListener: (e, l) => void listeners.get(e)?.delete(l),
    },
  };
  const emit = (e: string, arg: unknown) => {
    act(() => {
      listeners.get(e)?.forEach((l) => l(arg));
    });
  };
  return { w, request, emit };
}

function Harness() {
  const { wallet, busy, error, pickInjected, disconnect } = useWallet();
  return (
    <WalletButton
      wallet={wallet}
      busy={busy}
      error={error}
      onInjected={(c) => void pickInjected(c)}
      onDisconnect={disconnect}
    />
  );
}

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

async function connected() {
  const mm = eventful('MetaMask', 'io.metamask', [A]);
  uninstall = install(mm.w, coinbase);
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose a wallet' }));
  fireEvent.click(screen.getByRole('button', { name: 'MetaMask' }));
  await screen.findByRole('group', { name: 'Connected' });
  return mm;
}

describe('WalletButton connected', () => {
  it('shows the wallet, the shortened address and the two actions', async () => {
    await connected();
    const group = screen.getByRole('group', { name: 'Connected' });
    expect(group.textContent).toContain('MetaMask');
    expect(group.textContent).toContain('0x1111…1111');
    within(group).getByRole('button', { name: `Copy address ${A}` });
    within(group).getByRole('button', { name: 'Switch wallet' });
    within(group).getByRole('button', { name: 'Disconnect' });
    expect(sessionStorage.getItem('recharge.wallet')).toBe('io.metamask');
  });

  it('Switch wallet clears the memory, reopens the picker and re-asks the wallet for the account', async () => {
    const mm = await connected();
    fireEvent.click(screen.getByRole('button', { name: 'Switch wallet' }));
    expect(sessionStorage.getItem('recharge.wallet')).toBeNull();
    screen.getByRole('group', { name: 'Choose a wallet' });
    fireEvent.click(screen.getByRole('button', { name: 'MetaMask' }));
    await screen.findByRole('group', { name: 'Connected' });
    expect(mm.request).toHaveBeenCalledWith({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }],
    });
  });

  it('Disconnect returns to the connect button', async () => {
    await connected();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    screen.getByRole('button', { name: 'Choose a wallet' });
    expect(screen.queryByRole('group', { name: 'Connected' })).toBeNull();
    expect(sessionStorage.getItem('recharge.wallet')).toBeNull();
  });

  it('accountsChanged follows the new account; an empty list disconnects', async () => {
    const mm = await connected();
    mm.emit('accountsChanged', [B]);
    expect(screen.getByRole('group', { name: 'Connected' }).textContent).toContain('0x2222…2222');
    mm.emit('accountsChanged', []);
    screen.getByRole('button', { name: 'Choose a wallet' });
  });

  it('chainChanged shows the network once it differs from the app chain', async () => {
    const mm = await connected();
    const group = () => screen.getByRole('group', { name: 'Connected' });
    expect(group().textContent).not.toContain('Hedera EVM');
    mm.emit('chainChanged', '0x128');
    expect(group().textContent).toContain('Hedera EVM');
  });
});
