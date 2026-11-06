// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { forgetSponsorLogin, sponsorLogin } from '../lib/sponsor';

import type * as WalletModule from '../lib/wallet';
import type { Wallet } from '../lib/wallet';

vi.mock('../lib/wallet', async (original) => ({
  ...(await original<typeof WalletModule>()),
  chainNow: async () => Date.now(),
}));
afterEach(() => sessionStorage.clear());

describe('sponsorLogin reuse', () => {
  const id = `0x${'12'.repeat(32)}` as const;
  const walletFor = (address: string) => {
    const sign = vi.fn(async () => '0xaa');
    return { wallet: { address, signTypedData: sign } as unknown as Wallet, sign };
  };
  it('signs once per campaign and wallet in a tab, again after the API refused it', async () => {
    const { wallet, sign } = walletFor(`0x${'ab'.repeat(20)}`);
    const first = await sponsorLogin(wallet, id);
    expect(await sponsorLogin(wallet, id)).toEqual(first);
    expect(sign).toHaveBeenCalledTimes(1);
    await sponsorLogin(wallet, `0x${'34'.repeat(32)}`);
    expect(sign).toHaveBeenCalledTimes(2);
    forgetSponsorLogin(id, wallet.address);
    await sponsorLogin(wallet, id);
    expect(sign).toHaveBeenCalledTimes(3);
  });
  it("never hands one wallet another wallet's signature", async () => {
    const a = walletFor(`0x${'ab'.repeat(20)}`);
    const b = walletFor(`0x${'cd'.repeat(20)}`);
    await sponsorLogin(a.wallet, id);
    const login = await sponsorLogin(b.wallet, id);
    expect(login.sponsor).toBe(b.wallet.address);
    expect(b.sign).toHaveBeenCalledTimes(1);
  });
});
