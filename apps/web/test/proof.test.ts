import { describe, expect, it } from 'vitest';

import type { PaymentRequirements, SettleResult } from '@ethglobal/protocol/schemas';

import { ApiError } from '../lib/api';
import { buildProof, partnerOf, type ProofItem } from '../lib/proof';

const LPA = 'LPA:1$smdp.example.test$K2-ACTIVATION-CODE-0001';
const PIN = '4111222233334444';
const SEALED = {
  ciphertext: `0x${'cd'.repeat(48)}`,
  nonce: `0x${'ef'.repeat(24)}`,
  ephemeralPublicKey: `0x${'12'.repeat(32)}`,
};
const ENTITY = `0x${'ab'.repeat(32)}`;
const TX = `0x${'5'.repeat(64)}`;
const PLAN_KEY = `ent:${'9'.repeat(40)}`;
const PAYER = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';

const find = (items: ProofItem[], label: string) => items.find((i) => i.label === label);

describe('lib/proof.ts redaction — nothing secret leaves, whatever the input carries', () => {
  const response = {
    entitlementKey: PLAN_KEY,
    kind: 'free',
    status: 'ready',
    tier: 'orb',
    mbTotal: 1000,
    expiresAt: Date.UTC(2026, 10, 13, 3, 42),
    sealedLpa: SEALED,
    lpa: LPA,
    pin: PIN,
    claimTx: TX,
    receipt: { arkivKey: ENTITY, hcs: { topic: '0.0.6006', sequence: 7 } },
    nested: {
      activationCode: LPA,
      note: `install ${LPA}`,
      secretKey: '0xdeadbeef01',
      privateKey: '0xdeadbeef02',
      sessionPubKey: `0x${'77'.repeat(32)}`,
      webhookSecret: 'hush-hush',
    },
    list: [LPA, '4111 2222 3333 4444', 'kept'],
  };
  const SECRETS = [
    'K2-ACTIVATION-CODE',
    'LPA:1$',
    PIN,
    '4111 2222 3333 4444',
    SEALED.ciphertext,
    SEALED.ephemeralPublicKey,
    '0xdeadbeef01',
    '0xdeadbeef02',
    '77'.repeat(32),
    'hush-hush',
    PLAN_KEY,
  ];

  it('an LPA, a PIN, a sealed box or a private/session key in the response, the error or its details never appears', () => {
    const error = new ApiError(
      400,
      'invalid_request',
      'bad request',
      { pin: PIN, echoed: LPA },
      'rq-1',
    );
    for (const proof of [
      buildProof({ response, world: true }),
      buildProof({ error, world: true }),
      buildProof({
        response: {
          pin: PIN,
          settlement: { success: true, transaction: TX, network: 'eip155:84532', payer: PAYER },
        },
      }),
    ]) {
      const all = JSON.stringify(proof);
      for (const secret of SECRETS) expect(all).not.toContain(secret);
      // the same words the T-60 storage check refuses (the issuing proof is kept in IndexedDB)
      expect(all).not.toMatch(/secret|"sk"/i);
    }
  });

  it('keeps the rest: plan keys shortened, PINs and codes in arrays replaced, the evidence intact', () => {
    const raw = JSON.parse(buildProof({ response }).raw) as Record<string, unknown>;
    expect(raw.entitlementKey).toBe('ent:9999…9999');
    expect(raw.list).toEqual(['[redacted]', '[redacted]', 'kept']);
    expect(raw).not.toHaveProperty('sealedLpa');
    expect(raw).not.toHaveProperty('pin');
    expect(raw).toMatchObject({ claimTx: TX, tier: 'orb', receipt: { arkivKey: ENTITY } });
  });
});

describe('lib/proof.ts evidence — grouped by partner, each with its link', () => {
  const accepted: PaymentRequirements = {
    scheme: 'exact',
    network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    amount: '4000000',
    payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
  };
  const settlement: SettleResult = {
    success: true,
    transaction: TX,
    network: 'eip155:84532',
    payer: PAYER,
  };

  it('a Base top-up: the x402 terms signed and the settlement on BaseScan; HCS on HashScan; the Arkiv entity and its read', () => {
    const proof = buildProof({
      response: {
        entitlementKey: PLAN_KEY,
        mbTotal: 2000,
        mbUsed: 0,
        expiresAt: Date.UTC(2026, 10, 13, 3, 42),
        settlement,
        receipt: { arkivKey: ENTITY, hcs: { topic: '0.0.6006', sequence: 7 } },
      },
      status: 200,
      x402: { accepted, settlement },
    });
    expect(proof.ok).toBe(true);
    const base = proof.items.filter((i) => i.partner === 'base');
    expect(find(base, 'pay.hAmount')?.value).toBe('$4.00 USDC · 4000000');
    expect(find(base, 'proof.asset')?.value).toBe(accepted.asset);
    expect(find(base, 'proof.settlement')).toMatchObject({
      kind: 'hash',
      value: TX,
      href: `https://sepolia.basescan.org/tx/${TX}`,
    });
    expect(find(base, 'proof.payer')?.value).toBe(PAYER);
    expect(find(proof.items, 'issuing.hcs')).toMatchObject({
      partner: 'hedera',
      value: '0.0.6006 · #7',
      href: 'https://hashscan.io/testnet/topic/0.0.6006',
    });
    expect(find(proof.items, 'proof.entity')).toMatchObject({
      partner: 'arkiv',
      href: `https://rabdi.explorer.arkiv.network/entity/${ENTITY}`,
    });
    expect(find(proof.items, 'proof.expires')?.value).toBe('Fri 13 Nov 09:12 IST');
    const read = find(proof.items, 'proof.read')?.value ?? '';
    expect(read).toMatch(/^curl -s https:\/\/rpc\.rabdi\.db-chain\.testnet\.arkiv\.network\/ /);
    expect(read).toContain(`"method":"arkiv_getEntity","params":["${ENTITY}"]`);
    expect(find(proof.items, 'proof.status')?.value).toBe('200');
  });

  it('a World ID claim: DataDrop claim on Hedera EVM (HashScan), the level and the backend’s decision', () => {
    const proof = buildProof({
      response: { kind: 'free', tier: 'orb', claimTx: TX, receipt: { arkivKey: 'rcpt:ledger:1' } },
      status: 201,
      network: 'eip155:296',
      world: true,
    });
    expect(find(proof.items, 'proof.claimTx')).toMatchObject({
      partner: 'hedera',
      href: `https://hashscan.io/testnet/transaction/${TX}`,
    });
    const world = proof.items.filter((i) => i.partner === 'world');
    expect(world.map((i) => [i.label, i.value])).toEqual([
      ['proof.level', 'orb'],
      ['proof.verifiedBy', 'proof.backend'],
      ['proof.decision', 'proof.free'],
    ]);
    // a logical ledger key has no Arkiv page and no read line
    expect(find(proof.items, 'proof.entity')?.href).toBeUndefined();
    expect(find(proof.items, 'proof.read')).toBeUndefined();
  });

  it('a failure: the API’s status, code and request id; World says pay when no free bundle could be given', () => {
    const proof = buildProof({
      error: new ApiError(402, 'payment_required', 'pay instead', undefined, 'rq-42'),
      world: true,
    });
    expect(proof.ok).toBe(false);
    expect(find(proof.items, 'proof.status')?.value).toBe('402 payment_required');
    expect(find(proof.items, 'proof.requestId')?.value).toBe('rq-42');
    expect(find(proof.items, 'proof.decision')?.value).toBe('proof.pay');
    expect(JSON.parse(proof.raw)).toEqual({
      status: 402,
      error: 'payment_required',
      message: 'pay instead',
      requestId: 'rq-42',
    });
    // a failure before any request (a refused chain switch) says what failed, and claims no API answer
    const local = buildProof({ error: new TypeError('no wallet') });
    expect(find(local.items, 'proof.status')).toBeUndefined();
    expect(JSON.parse(local.raw)).toEqual({ error: 'TypeError', message: 'no wallet' });
    // no answer at all: the code says so, no status 0
    expect(
      find(buildProof({ error: new ApiError(0, 'network', 'timeout') }).items, 'proof.status')
        ?.value,
    ).toBe('network');
  });

  it('a gift: the ENS name and the address it resolved to; Hedera x402 shows its fee payer', () => {
    const proof = buildProof({
      response: { giftId: `0x${'1'.repeat(64)}`, pin: PIN, name: 'rahul.eth', to: PAYER },
      x402: {
        accepted: {
          ...accepted,
          network: 'hedera:testnet',
          asset: '0.0.429274',
          payTo: '0.0.5005',
          extra: { feePayer: '0.0.7007' },
        },
      },
      ens: { name: 'rahul.eth', address: PAYER },
    });
    expect(proof.items.filter((i) => i.partner === 'ens').map((i) => i.value)).toEqual([
      'rahul.eth',
      PAYER,
    ]);
    expect(find(proof.items, 'pay.hFeePayer')).toMatchObject({
      partner: 'hedera',
      value: '0.0.7007',
    });
    expect(JSON.stringify(proof)).not.toContain(PIN);
  });

  it('wallet transactions and the contract they called, by chain', () => {
    const proof = buildProof({
      txs: [{ label: 'proof.pauseTx', hash: TX, network: 'eip155:296' }],
      contract: { address: '0x90193C961A926261B756D1E5bb255e67ff9498A1', network: 'eip155:296' },
    });
    expect(find(proof.items, 'proof.pauseTx')?.href).toBe(
      `https://hashscan.io/testnet/transaction/${TX}`,
    );
    expect(find(proof.items, 'proof.contract')?.href).toBe(
      'https://hashscan.io/testnet/contract/0x90193C961A926261B756D1E5bb255e67ff9498A1',
    );
    expect(JSON.parse(proof.raw)).toEqual({
      transactions: [{ label: 'proof.pauseTx', hash: TX, network: 'eip155:296' }],
    });
  });

  it('partners by chain: Hedera (native and EVM), Base, else the local chain', () => {
    expect(['hedera:testnet', 'eip155:296', 'eip155:84532', 'eip155:31337'].map(partnerOf)).toEqual(
      ['hedera', 'hedera', 'base', 'chain'],
    );
  });
});
