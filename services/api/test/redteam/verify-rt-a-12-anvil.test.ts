/**
 * Red-team verification variant for RT-A-12 (self-run relayer: viem nonceManager + one SerialQueue; public settle
 * refuses dust and rate-limits per payer), on Anvil: four buyers top up one entitlement at once WHILE two strangers
 * post full-price authorizations to the public /facilitator/settle and a human claims (the attestor's own chain
 * writes). Property: every buyer is served (no nonce collision makes a paying user fail) and the payout balance grows by
 * exactly the settled amounts. Skipped without Foundry or forge artefacts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anvilAccounts, anvilKeys, anvilRoles, fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type { PaymentRequirements } from '@ethglobal/protocol/schemas';
import { decodePaymentRequired } from '@ethglobal/protocol/x402';

import { anvilReady, startChain, type Chain } from './rt-support.js';
import { createApp } from '../../src/app.js';
import { buildDeps } from '../../src/deps.js';
import { createLogger } from '../../src/logger.js';
import { storedCampaign } from '../support/campaign.js';
import { paymentHeader, scopedCampaignId } from '../support/client.js';

const sponsor = anvilAccounts[anvilRoles.sponsor];
let chain: Chain;
let ipN = 0;

describe.skipIf(!anvilReady)('verify RT-A-12: relayer under mixed concurrent load on Anvil', () => {
  beforeAll(async () => {
    chain = await startChain();
  }, 60_000);
  afterAll(() => chain?.stop());

  it('4 buyers + 2 public full-price settles + a claim, all at once ⇒ every buyer 200', async () => {
    const id = scopedCampaignId(sponsor, 120n);
    const sponsorKey = anvilKeys[anvilRoles.sponsor];
    await chain.call(sponsorKey, chain.usdc, 'MockUSDC3009', 'approve', [
      chain.dataDrop,
      10n * 500_000n,
    ]);
    const end = (await chain.now()) + 86_400;
    await chain.call(sponsorKey, chain.dataDrop, 'DataDrop', 'createCampaign', [
      id,
      10n * 500_000n,
      500_000n,
      100,
      BigInt(end),
    ]);
    const deps = await buildDeps(
      {
        MODE: 'local',
        X402_FACILITATOR: 'self',
        TRUST_PROXY: '1',
        LOG_LEVEL: 'silent',
        TOPUPS_PER_ICCID_PER_DAY: '10',
        ANVIL_RPC_URL: chain.rpc,
        DATADROP_ADDRESS: chain.dataDrop,
        USDC_ADDRESS: chain.usdc,
      },
      { logger: createLogger('silent') },
    );
    await deps.stores.campaigns.put(
      storedCampaign({
        id,
        sponsor,
        name: 'Anvil RT verify A-12',
        maxClaims: 20,
        claimsPerHour: 100,
        contract: chain.dataDrop,
        createdAt: Date.now(),
        expiresAt: end * 1000,
      }),
    );
    const app = createApp(deps);
    const req = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('x-forwarded-for', `198.18.3.${++ipN % 250}`);
      return app.request(path, { ...init, headers });
    };
    const post = (path: string, body: unknown) =>
      req(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const claim = async (seed: string) => {
      const spk = bytesToHex(generateSessionKeypair().publicKey);
      const ch = (await (
        await post('/challenge', { audience: 'recharge', path: '/claim', sessionPubKey: spk })
      ).json()) as { signal: Hex };
      return post('/claim', {
        proof: fixtureProof('orb', ch.signal, seed),
        campaignId: id,
        challenge: ch,
        sessionPubKey: spk,
      });
    };
    const { entitlementKey } = (await (await claim('verify-a12-owner')).json()) as {
      entitlementKey: string;
    };
    const url = `/esim/topup?key=${encodeURIComponent(entitlementKey)}&mb=1000`;
    const offer: PaymentRequirements = decodePaymentRequired(
      (await req(url)).headers.get('PAYMENT-REQUIRED')!,
    ).accepts[0]!;
    // startChain funds sponsor / human / stranger; fund three more buyers (never the relayer #6)
    for (const i of [anvilRoles.agent, 0, 9]) {
      await chain.call(anvilKeys[0], chain.usdc, 'MockUSDC3009', 'mint', [
        anvilAccounts[i],
        1_000_000_000n,
      ]);
    }
    const buyers = [anvilRoles.human, anvilRoles.agent, 0, 9].map((i) => anvilKeys[i]!);
    const strangers = [anvilKeys[anvilRoles.stranger], anvilKeys[anvilRoles.sponsor]];
    const now = Date.now();
    const buyHeaders = await Promise.all(buyers.map((k) => paymentHeader(k, offer, { now })));
    const publicSettles = await Promise.all(strangers.map((k) => paymentHeader(k, offer, { now })));
    const usdc = (who: string) =>
      chain.read<bigint>(chain.usdc, 'MockUSDC3009', 'balanceOf', [who]);
    const before = await usdc(offer.payTo);
    const results = await Promise.all([
      ...buyHeaders.map((h) => req(url, { headers: { 'PAYMENT-SIGNATURE': h } })),
      ...publicSettles.map((h) =>
        post('/facilitator/settle', {
          x402Version: 2,
          paymentPayload: JSON.parse(Buffer.from(h, 'base64').toString()) as unknown,
          paymentRequirements: offer,
        }),
      ),
      claim('verify-a12-concurrent-claim'),
    ]);
    const buyerStatuses = results.slice(0, 4).map((r) => r.status);
    expect(buyerStatuses).toEqual([200, 200, 200, 200]);
    const settled = results.slice(0, 6).filter((r) => r.status === 200).length;
    expect(results[6]!.status).toBe(201);
    // payTo is DataDrop's payout, which also receives the concurrent claim's pricePerClaim (500 000)
    expect((await usdc(offer.payTo)) - before).toBe(
      BigInt(settled) * BigInt(offer.amount) + 500_000n,
    );
  }, 120_000);
});
