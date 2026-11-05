import { PrivateKey } from '@x402/hedera';
import { describe, expect, it } from 'vitest';

import type { PaymentRequirements } from '@ethglobal/protocol/schemas';

import {
  urlOf,
  ALLOW,
  FEE_PAYER,
  HEDERA_ACCEPT,
  HEDERA_AGENT,
  HEDERA_MAINNET_ACCEPT,
  hederaPayer,
  MAINNET_ALLOW,
  MAINNET_USDC,
} from './helpers.js';
import { TermsGuard } from '../src/buyer.js';
import { parseAllowList } from '../src/config.js';
import {
  AgentKitConsensusLog,
  AgentKitWallet,
  createHederaAgentKit,
  HederaAgentKitSigner,
  HederaPayer,
} from '../src/payers/hedera.js';

const resource = {
  url: 'http://api.test/esim/topup',
  description: 'top-up',
  mimeType: 'application/json',
};
const req = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  ...HEDERA_ACCEPT,
  amount: '400000',
  ...over,
});

describe('HederaPayer (HederaAgentKitSigner)', () => {
  it('payload is { transaction }, transactionId.accountId == extra.feePayer', async () => {
    const payer = hederaPayer();
    const paid = await payer.sign(req(), { resource, now: Date.now() });
    expect(Object.keys(paid.payload)).toEqual(['transaction']);
    expect(paid).toMatchObject({ x402Version: 2, accepted: req() });
    const { inspectHederaTransaction } = await import('@x402/hedera');
    const tx = inspectHederaTransaction((paid.payload as { transaction: string }).transaction);
    expect(tx.transactionIdAccountId).toBe(FEE_PAYER);
    expect(HederaAgentKitSigner).toBe(HederaPayer);
    expect(payer.accountId).toBe(HEDERA_AGENT);
  });

  it('refuses an entry whose feePayer is not allow-listed (choose returns nothing, nothing is built)', () => {
    const payer = hederaPayer();
    const guard = new TermsGuard({
      payers: [payer],
      allowList: parseAllowList(ALLOW),
      expectedUsd6: 400_000n,
      maxUsd6PerStep: 1_000_000n,
    });
    expect(guard.choose([req({ extra: { feePayer: '0.0.6666' } })])).toBeUndefined();
    expect(guard.rejections[0]).toMatchObject({ field: 'fee-payer' });
    expect(payer.signatures).toBe(0);
  });

  it('refuses: wrong network/asset, missing or non-string fee payer, validity above 180 s [RT-A-15]', () => {
    const payer = hederaPayer();
    expect(payer.refusal(req({ network: 'hedera:mainnet' }))).toBe('network');
    expect(payer.refusal(req({ asset: '0.0.0' }))).toBe('asset');
    expect(payer.refusal(req({ extra: {} }))).toBe('fee-payer');
    expect(payer.refusal(req({ extra: { feePayer: 123 } }))).toBe('fee-payer');
    expect(payer.refusal(req({ extra: { feePayer: { id: FEE_PAYER } } }))).toBe('fee-payer');
    // nested extra beside a well-formed feePayer is ignored, not a refusal
    expect(
      payer.refusal(
        req({ extra: { feePayer: FEE_PAYER, features: { smartWalletSupported: true } } }),
      ),
    ).toBeUndefined();
    expect(payer.refusal(req({ maxTimeoutSeconds: 181 }))).toBe('timeout');
    expect(payer.choose([req({ asset: '0.0.0' }), req()])).toEqual(req());
  });

  it('refuses to send a transaction that is not exactly the agreed transfer', async () => {
    const good = await hederaPayer().sign(req(), { resource, now: Date.now() });
    const transaction = (good.payload as { transaction: string }).transaction;
    const scheme = {
      createPaymentPayload: async () => ({ x402Version: 2, payload: { transaction } }),
    };
    const inspect = (over: Record<string, unknown>) => () => ({
      transactionType: 'T',
      transactionId: `${FEE_PAYER}@1.1`,
      transactionIdAccountId: FEE_PAYER,
      hasNonTransferOperations: false,
      hbarTransfers: [],
      tokenTransfers: {
        '0.0.429274': [
          { accountId: HEDERA_AGENT, amount: '-400000' },
          { accountId: '0.0.6006', amount: '400000' },
        ],
      },
      ...over,
    });
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ transactionIdAccountId: '0.0.1' }, /feePayer/],
      [{ hbarTransfers: [{ accountId: HEDERA_AGENT, amount: '-1' }] }, /plain token transfer/],
      [
        { tokenTransfers: { '0.0.429274': [{ accountId: HEDERA_AGENT, amount: '-400000' }] } },
        /two legs/,
      ],
      [
        {
          tokenTransfers: {
            '0.0.429274': [
              { accountId: HEDERA_AGENT, amount: '-500000' },
              { accountId: '0.0.6006', amount: '500000' },
            ],
          },
        },
        /payer leg/,
      ],
      [
        {
          tokenTransfers: {
            '0.0.429274': [
              { accountId: HEDERA_AGENT, amount: '-400000' },
              { accountId: '0.0.7', amount: '400000' },
            ],
          },
        },
        /payTo leg/,
      ],
    ];
    for (const [over, message] of cases) {
      const payer = new HederaPayer({
        accountId: HEDERA_AGENT,
        network: HEDERA_ACCEPT.network,
        asset: HEDERA_ACCEPT.asset,
        scheme,
        balance: async () => 10_000_000n,
        inspect: inspect(over),
      });
      await expect(payer.sign(req(), { resource, now: Date.now() })).rejects.toThrow(message);
    }
    const empty = new HederaPayer({
      accountId: HEDERA_AGENT,
      network: HEDERA_ACCEPT.network,
      asset: HEDERA_ACCEPT.asset,
      scheme: { createPaymentPayload: async () => ({ x402Version: 2, payload: {} }) },
      balance: async () => 10_000_000n,
    });
    await expect(empty.sign(req(), { resource, now: Date.now() })).rejects.toThrow(
      /no transaction/,
    );
    await expect(
      empty.sign(req({ asset: '0.0.0' }), { resource, now: Date.now() }),
    ).rejects.toThrow(/refuses/);
  });

  it('AgentKitWallet: association once if the mirror shows none; balance from the mirror', async () => {
    const calls: { method: string; args: unknown }[] = [];
    let associated = false;
    const mirror: typeof fetch = async (input) => {
      expect(urlOf(input)).toBe(
        `https://mirror.test/api/v1/accounts/${HEDERA_AGENT}/tokens?token.id=0.0.429274`,
      );
      return Response.json({
        tokens: associated ? [{ token_id: '0.0.429274', balance: 2_500_000 }] : [],
      });
    };
    const wallet = new AgentKitWallet({
      api: {
        run: async (method, args) => {
          calls.push({ method, args });
          associated = true;
          return '{}';
        },
      },
      accountId: HEDERA_AGENT,
      mirrorUrl: 'https://mirror.test/',
      fetch: mirror,
    });
    expect(await wallet.tokenBalance('0.0.429274')).toBeNull();
    expect(await wallet.ensureAssociated('0.0.429274')).toBe('associated');
    expect(calls).toEqual([{ method: 'associate_token_tool', args: { tokenIds: ['0.0.429274'] } }]);
    expect(await wallet.ensureAssociated('0.0.429274')).toBe('already');
    expect(await wallet.tokenBalance('0.0.429274')).toBe(2_500_000n);
  });

  it('AgentKitConsensusLog: parses JSON output, falls back to the text form; read is not offered', async () => {
    const json = new AgentKitConsensusLog(
      {
        run: async () =>
          JSON.stringify({ raw: { transactionId: '0.0.5005@1.2', topicSequenceNumber: '12' } }),
      },
      () => 5,
    );
    expect(await json.submit('0.0.7001', '{}')).toEqual({
      sequence: 12,
      consensusAt: 5,
      txId: '0.0.5005@1.2',
    });
    const text = new AgentKitConsensusLog(
      {
        run: async () =>
          'Message submitted successfully with transaction id 0.0.5005@1793750069.580498333',
      },
      () => 6,
    );
    expect(await text.submit('0.0.7001', '{}')).toEqual({
      sequence: 0,
      consensusAt: 6,
      txId: '0.0.5005@1793750069.580498333',
    });
    await expect(text.read()).rejects.toThrow(/write-only/);
  });

  it('createHederaAgentKit wires one Client into the Agent Kit API and the x402 scheme (no network until used)', async () => {
    const key = PrivateKey.generateECDSA().toStringRaw();
    const kit = createHederaAgentKit({
      accountId: HEDERA_AGENT,
      privateKey: key,
      network: 'hedera:testnet',
      asset: '0.0.429274',
      mirrorUrl: 'https://mirror.test',
      now: Date.now,
      fetch: async () => Response.json({ tokens: [] }),
    });
    try {
      expect(kit.ledgerId).toBe('testnet');
      expect(kit.payer?.network).toBe('hedera:testnet');
      expect(kit.payer?.asset).toBe('0.0.429274');
      expect(await kit.payer!.balanceUsd6()).toBe(0n);
      const paid = await kit
        .payer!.sign(req(), { resource, now: Date.now() })
        .catch((e: unknown) => e);
      expect(paid).toMatchObject({ reason: 'insufficient-balance' });
      expect(typeof kit.api.run).toBe('function');
    } finally {
      kit.close();
    }
  });

  it('hedera:mainnet allow-list ⇒ mainnet Client, mainnet USDC on the mirror, payer pinned to (mainnet, 0.0.456858)', async () => {
    const urls: string[] = [];
    const kit = createHederaAgentKit({
      accountId: HEDERA_AGENT,
      privateKey: PrivateKey.generateECDSA().toStringRaw(),
      network: 'hedera:mainnet',
      asset: MAINNET_USDC,
      mirrorUrl: 'https://mainnet.mirror.test',
      now: Date.now,
      fetch: async (input) => {
        urls.push(urlOf(input));
        return Response.json({ tokens: [{ token_id: MAINNET_USDC, balance: '7000000' }] });
      },
    });
    try {
      expect(kit.ledgerId).toBe('mainnet');
      expect(kit.payer).toMatchObject({ network: 'hedera:mainnet', asset: MAINNET_USDC });
      expect(await kit.wallet.ensureAssociated(kit.payer!.asset)).toBe('already');
      expect(await kit.payer!.balanceUsd6()).toBe(7_000_000n);
      expect(urls).toEqual([
        `https://mainnet.mirror.test/api/v1/accounts/${HEDERA_AGENT}/tokens?token.id=${MAINNET_USDC}`,
        `https://mainnet.mirror.test/api/v1/accounts/${HEDERA_AGENT}/tokens?token.id=${MAINNET_USDC}`,
      ]);
      // a testnet 402 is the wrong network; a mainnet 402 naming testnet USDC is the wrong asset
      expect(kit.payer!.refusal(req())).toBe('network');
      expect(kit.payer!.refusal(req({ network: 'hedera:mainnet' }))).toBe('asset');
      expect(kit.payer!.refusal(req({ ...HEDERA_MAINNET_ACCEPT }))).toBeUndefined();
    } finally {
      kit.close();
    }
  });

  it('no hedera:* allow-list entry ⇒ no Hedera payer (the wallet and HCS log still exist)', () => {
    const kit = createHederaAgentKit({
      accountId: HEDERA_AGENT,
      privateKey: PrivateKey.generateECDSA().toStringRaw(),
      network: 'hedera:testnet',
      mirrorUrl: 'https://mirror.test',
      now: Date.now,
    });
    try {
      expect(kit.payer).toBeUndefined();
      expect(typeof kit.wallet.ensureAssociated).toBe('function');
      expect(typeof kit.consensus.submit).toBe('function');
    } finally {
      kit.close();
    }
  });

  it('mainnet payer signs a mainnet USDC transfer; a 402 naming 0.0.429274 is refused before anything is built', async () => {
    const payer = hederaPayer({ network: 'hedera:mainnet', asset: MAINNET_USDC });
    const mainnetReq = req({ ...HEDERA_MAINNET_ACCEPT });
    const paid = await payer.sign(mainnetReq, { resource, now: Date.now() });
    expect(paid.accepted).toEqual(mainnetReq);
    const { inspectHederaTransaction } = await import('@x402/hedera');
    const tx = inspectHederaTransaction((paid.payload as { transaction: string }).transaction);
    expect(Object.keys(tx.tokenTransfers)).toEqual([MAINNET_USDC]);
    expect(tx.transactionIdAccountId).toBe(FEE_PAYER);
    expect(payer.signatures).toBe(1);

    const guard = new TermsGuard({
      payers: [payer],
      allowList: parseAllowList(MAINNET_ALLOW),
      expectedUsd6: 400_000n,
      maxUsd6PerStep: 1_000_000n,
    });
    expect(guard.choose([req({ network: 'hedera:mainnet' })])).toBeUndefined();
    expect(guard.rejections).toEqual([{ index: 0, network: 'hedera:mainnet', field: 'asset' }]);
    expect(guard.choose([req()])).toBeUndefined();
    expect(guard.rejections.at(-1)).toMatchObject({ field: 'network' });
    expect(payer.signatures).toBe(1);
  });
});
