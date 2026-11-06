// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@ethglobal/crypto';
import type { MeResponse } from '@ethglobal/protocol/schemas';
import { nativeCancelMessage, nativePayerBinding } from '@ethglobal/protocol/typed-data';

import { PlanActions } from '../components/PlanActions';

import type * as ApiModule from '../lib/api';
import type * as HooksModule from '../lib/hooks';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  sign: vi.fn(),
  cancel: vi.fn(),
  challenge: vi.fn(),
  ensure: vi.fn(),
  evmSign: vi.fn(),
}));
vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('../lib/hooks', async (original) => ({
  ...(await original<typeof HooksModule>()),
  useWallet: () => ({ wallet: { address: `0x${'ab'.repeat(20)}`, signTypedData: mocks.evmSign } }),
  useEnsureChain: () => mocks.ensure,
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: { challenge: mocks.challenge, planCancel: mocks.cancel },
}));
vi.mock('../lib/hedera-wc', () => ({
  isHederaChain: (network: string) => network === 'hedera:testnet',
  connectHashPack: mocks.connect,
  signHashPackMessage: mocks.sign,
  hashPackLink: () => 'https://link.hashpack.app/wc',
}));
const KEY = 'paid:native-test';
const session = { topic: 'native-session', chain: 'hedera:testnet', accountId: '0.0.7001' };
const me: MeResponse = {
  entitlementKey: KEY,
  arkivKey: 'ent_native',
  kind: 'paid',
  status: 'ready',
  tier: 'none',
  mbTotal: 1000,
  mbUsed: 0,
  remainingMb: 1000,
  usageAsOf: Date.now(),
  usageSource: 'none',
  expiresAt: Date.now() + 86400000,
  ledgerReadAt: Date.now(),
  cached: false,
  degraded: false,
  network: 'hedera:testnet',
  refundable: { to: '0.0.7001', network: 'hedera:testnet', usd6: '1200000' },
};
afterEach(() => {
  vi.resetAllMocks();
});
const open = async (accountId = session.accountId) => {
  mocks.connect.mockResolvedValue({ session: Promise.resolve({ ...session, accountId }) });
  render(<PlanActions entitlementKey={KEY} me={me} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel plan & refund $1.20' }));
  fireEvent.click(screen.getByRole('button', { name: 'Connect the HashPack account that paid' }));
  await screen.findByTestId('hashpack-account');
};
describe('native cancellation', () => {
  it('signs the canonical challenge with the original native payer, never the connected EVM wallet', async () => {
    const challenge = {
      nonce: `0x${'ab'.repeat(32)}` as const,
      expiresAt: Date.now() + 300000,
      signature: 'server',
    };
    mocks.challenge.mockResolvedValue(challenge);
    mocks.sign.mockResolvedValue('native-signature-map');
    mocks.cancel.mockResolvedValue({
      refund: { network: 'hedera:testnet', usd6: '1200000', tx: '0.0.7001@1790000000.000000001' },
    });
    await open();
    expect(screen.getByRole('group').textContent).toContain('$1.20 goes back to 0.0.7001');
    expect(mocks.sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('plan-cancel-yes'));
    await screen.findByTestId('plan-cancelled');
    expect(mocks.challenge).toHaveBeenCalledWith(
      '/plan/cancel',
      sha256Hex(nativePayerBinding('hedera:testnet', '0.0.7001')),
    );
    const body = mocks.cancel.mock.calls[0]![0] as { issuedAt: number };
    expect(mocks.cancel).toHaveBeenCalledWith({
      authKind: 'hedera',
      entitlementKey: KEY,
      payer: '0.0.7001',
      network: 'hedera:testnet',
      challenge,
      issuedAt: body.issuedAt,
      signatureMap: 'native-signature-map',
    });
    expect(mocks.sign).toHaveBeenCalledWith(
      session,
      nativeCancelMessage({
        network: 'hedera:testnet',
        payer: '0.0.7001',
        entitlementHash: sha256Hex(KEY),
        nonce: challenge.nonce,
        issuedAt: body.issuedAt,
      }),
    );
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.evmSign).not.toHaveBeenCalled();
  });
  it('never offers cancellation from a different native account', async () => {
    await open('0.0.9999');
    expect(screen.queryByTestId('plan-cancel-yes')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('0.0.7001');
    expect(mocks.challenge).not.toHaveBeenCalled();
  });
  it('a rejected message returns to confirmation without cancelling or requesting a transfer', async () => {
    mocks.challenge.mockResolvedValue({ nonce: `0x${'ab'.repeat(32)}` });
    mocks.sign.mockRejectedValue({ code: 4001 });
    await open();
    fireEvent.click(screen.getByTestId('plan-cancel-yes'));
    await waitFor(() =>
      expect(screen.getByTestId('plan-cancel-yes').hasAttribute('disabled')).toBe(false),
    );
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(screen.queryByTestId('plan-cancelled')).toBeNull();
  });
});
