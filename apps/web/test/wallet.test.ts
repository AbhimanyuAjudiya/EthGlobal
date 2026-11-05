// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { announce, coinbase, install, metamask, provider, wallet } from './eip6963';
import {
  discoverInjected,
  rememberedInjected,
  rememberInjected,
  watchInjected,
  type Announced,
  type Eip1193,
} from '../lib/wallet';

const win = window as unknown as { ethereum?: Eip1193 };
let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  delete win.ethereum;
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('EIP-6963 discovery', () => {
  it('lists every announced wallet once, de-duplicated by rdns, each with its own provider', async () => {
    uninstall = install(metamask, coinbase, { ...metamask, provider: provider() });
    const found = await discoverInjected(20);
    expect(found.map((w) => w.info.name)).toEqual(['MetaMask', 'Coinbase Wallet']);
    expect(found[0]?.provider).toBe(metamask.provider);
    expect(found[1]?.provider).toBe(coinbase.provider);
  });

  it('with no announcement falls back to window.ethereum, else finds nothing', async () => {
    expect(await discoverInjected(5)).toEqual([]);
    const legacy = provider();
    win.ethereum = legacy;
    const found = await discoverInjected(5);
    expect(found).toHaveLength(1);
    expect(found[0]?.provider).toBe(legacy);
    expect(found[0]?.info.rdns).toBe('injected');
  });

  it('a late announcement reaches the watcher; nothing after unsubscribe', () => {
    const onChange = vi.fn<(found: Announced[]) => void>();
    const stop = watchInjected(onChange);
    expect(onChange).not.toHaveBeenCalled();
    announce(metamask);
    expect(onChange).toHaveBeenLastCalledWith([metamask]);
    announce(coinbase);
    expect(onChange).toHaveBeenLastCalledWith([metamask, coinbase]);
    announce(coinbase);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    announce(wallet('Rabby', 'io.rabby'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ignores a malformed announcement', () => {
    const onChange = vi.fn<(found: Announced[]) => void>();
    const stop = watchInjected(onChange);
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', { detail: { info: { name: 'x' } } }),
    );
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', { detail: { provider: provider() } }),
    );
    window.dispatchEvent(new Event('eip6963:announceProvider'));
    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('is inert without a window (SSR)', async () => {
    vi.stubGlobal('window', undefined);
    expect(await discoverInjected(1)).toEqual([]);
    expect(watchInjected(() => undefined)).toBeTypeOf('function');
  });

  it('remembers the chosen wallet for the tab', () => {
    expect(rememberedInjected()).toBeUndefined();
    rememberInjected('com.coinbase.wallet');
    expect(rememberedInjected()).toBe('com.coinbase.wallet');
  });
});
