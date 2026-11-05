/** Fake browser extensions for the EIP-6963 tests: `install` answers every `eip6963:requestProvider` with them. */
import type { Announced, Eip1193 } from '../lib/wallet';

export const ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

export const provider = (): Eip1193 => ({ request: () => Promise.resolve(undefined) });

export const wallet = (name: string, rdns: string): Announced => ({
  info: { uuid: rdns, name, icon: ICON, rdns },
  provider: provider(),
});

export const metamask = wallet('MetaMask', 'io.metamask');
export const coinbase = wallet('Coinbase Wallet', 'com.coinbase.wallet');

export function announce(w: Announced): void {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: w }));
}

export function install(...wallets: Announced[]): () => void {
  const reply = () => wallets.forEach(announce);
  window.addEventListener('eip6963:requestProvider', reply);
  return () => window.removeEventListener('eip6963:requestProvider', reply);
}
