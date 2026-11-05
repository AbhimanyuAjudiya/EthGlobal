import { describe, expect, it } from 'vitest';

import { NETWORKS } from '@ethglobal/protocol/ids';

import { buildAcceptTemplates, loadAddresses } from '../src/accepts.js';
import { parseEnv } from '../src/env.js';
import { harness } from './support/harness.js';

const env = (networks: string, extra: Record<string, string> = {}) =>
  parseEnv({ X402_NETWORKS: networks, PAYOUT_HEDERA_ACCOUNT: '0.0.5005', ...extra });
const ANVIL_USDC = '0x34A1D3fff3958843C43aD80F30b94c510645C316';

describe('accepts templates (A-20, A-21)', () => {
  it('eip155:84532 carries extra { name: "USDC", version: "2" }; Anvil carries "USD Coin"', () => {
    const [base, anvil] = buildAcceptTemplates({
      env: env('eip155:84532,eip155:31337'),
      anvilUsdc: ANVIL_USDC,
    });
    expect(base).toMatchObject({
      network: NETWORKS.baseSepolia,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      extra: { name: 'USDC', version: '2' },
      maxTimeoutSeconds: 300,
    });
    expect(anvil).toMatchObject({ asset: ANVIL_USDC, extra: { name: 'USD Coin', version: '2' } });
  });

  it('hedera:testnet carries extra.feePayer from /supported and maxTimeoutSeconds 180', () => {
    const [hedera] = buildAcceptTemplates({
      env: env('hedera:testnet'),
      hederaFeePayer: '0.0.9185802',
    });
    expect(hedera).toMatchObject({
      asset: '0.0.429274',
      payTo: '0.0.5005',
      maxTimeoutSeconds: 180,
      extra: { feePayer: '0.0.9185802' },
    });
  });

  it('fee-payer pin mismatch, a missing fee payer, a missing payout account or an unknown domain → boot fails', () => {
    expect(() =>
      buildAcceptTemplates({
        env: env('hedera:testnet', { X402_HEDERA_FEE_PAYER: '0.0.7162784' }),
        hederaFeePayer: '0.0.9185802',
      }),
    ).toThrow(/fee payer/);
    expect(() => buildAcceptTemplates({ env: env('hedera:testnet') })).toThrow(/feePayer/);
    expect(() =>
      buildAcceptTemplates({
        env: parseEnv({ X402_NETWORKS: 'hedera:testnet' }),
        hederaFeePayer: '0.0.1',
      }),
    ).toThrow(/PAYOUT_HEDERA_ACCOUNT/);
    expect(() =>
      buildAcceptTemplates({ env: { ...env('eip155:31337'), X402_NETWORKS: ['eip155:11155111'] } }),
    ).toThrow(/EIP-712 domain/);
    expect(() => buildAcceptTemplates({ env: env('eip155:31337') })).toThrow(/no USDC asset/);
  });

  it('a fee payer outside the Hedera id form never reaches accepts[] [RT-A-16]', () => {
    for (const hederaFeePayer of [
      'CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5',
      '0.0.9185802@1.2',
      '9185802',
      '',
    ])
      expect(() => buildAcceptTemplates({ env: env('hedera:testnet'), hederaFeePayer })).toThrow(
        /feePayer/,
      );
  });

  it('no 402 body ever carries the v1 amount field (A-18)', async () => {
    const h = await harness();
    const res = await h.json('/gift', { name: 'bob.eth', mb: 300 });
    expect(await res.text()).not.toMatch(/maxAmountRequired/);
    expect(Buffer.from(res.headers.get('PAYMENT-REQUIRED') ?? '', 'base64').toString()).not.toMatch(
      /maxAmountRequired/,
    );
  });

  it('loadAddresses reads deploy/addresses.<slug>.json and answers undefined for an unknown slug', () => {
    expect(loadAddresses('no-such-chain')).toBeUndefined();
  });
});
