/**
 * Red team wave 2 (unscripted), real Anvil: the RT-A-03 budget burst through buildDeps(X402_FACILITATOR=self) against
 * the deployed DataDrop, and RT-A-12 — concurrent real EIP-3009 settlements through the self-run relayer.
 * Skipped without Foundry or forge artefacts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { anvilAccounts, anvilKeys, anvilRoles, fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import { campaignFromPayload } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import type { PaymentRequirements } from '@ethglobal/protocol/schemas';
import { decodePaymentRequired } from '@ethglobal/protocol/x402';

import { createApp } from '../../src/app.js';
import { buildDeps } from '../../src/deps.js';
import { createLogger } from '../../src/logger.js';
import { paymentHeader, scopedCampaignId } from '../support/client.js';
import { anvilReady, startChain, type Chain } from './rt-support.js';

const sponsor = anvilAccounts[anvilRoles.sponsor];
let chain: Chain;
let ipN = 0;

async function stack(salt: bigint, budget: bigint) {
  const id = scopedCampaignId(sponsor, salt);
  const sponsorKey = anvilKeys[anvilRoles.sponsor];
  await chain.call(sponsorKey, chain.usdc, 'MockUSDC3009', 'approve', [chain.dataDrop, budget]);
  const end = (await chain.now()) + 86_400;
  await chain.call(sponsorKey, chain.dataDrop, 'DataDrop', 'createCampaign', [
    id,
    budget,
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
      ANVIL_RPC_URL: chain.rpc,
      DATADROP_ADDRESS: chain.dataDrop,
      USDC_ADDRESS: chain.usdc,
    },
    { logger: createLogger('silent') },
  );
  await deps.stores.campaigns.put(
    campaignFromPayload({
      v: 1,
      id,
      sponsor,
      name: 'Anvil RT',
      bundleMb: { orb: 300, document: 160, device: 0 },
      pricePerClaimUsd6: '500000',
      maxClaims: 20,
      claimsPerHour: 100,
      validityDays: 7,
      wholesaleUsd6PerGb: '1140000',
      idResaleUsd6: '500000',
      planId: 'in-300mb-7d',
      network: 'eip155:31337',
      contract: chain.dataDrop,
      createdAt: Date.now(),
      expiresAt: end * 1000,
    }),
  );
  const app = createApp(deps);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.18.1.${++ipN % 250}` },
      body: JSON.stringify(body),
    });
  const claim = async (seed: string) => {
    const spk = bytesToHex(generateSessionKeypair().publicKey);
    const res = await post('/challenge', {
      audience: 'recharge',
      path: '/claim',
      sessionPubKey: spk,
    });
    const ch = (await res.json()) as { signal: Hex };
    return post('/claim', {
      proof: fixtureProof('orb', ch.signal, seed),
      campaignId: id,
      challenge: ch,
      sessionPubKey: spk,
    });
  };
  /** A provisioned entitlement, its top-up URL and the 402 terms. */
  const toppable = async (seed: string): Promise<{ url: string; req: PaymentRequirements }> => {
    const { entitlementKey } = (await (await claim(seed)).json()) as { entitlementKey: string };
    const url = `/esim/topup?key=${encodeURIComponent(entitlementKey)}&mb=100`;
    const quote = await app.request(url);
    return { url, req: decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED')!).accepts[0]! };
  };
  return { deps, app, post, claim, toppable };
}

describe.skipIf(!anvilReady)(
  'attack: rt Anvil — races against the real DataDrop and MockUSDC3009',
  () => {
    beforeAll(async () => {
      chain = await startChain();
    }, 60_000);
    afterAll(() => chain?.stop());

    // RT-FINDING RT-A-03 (Anvil): 3 claims of budget, 8 concurrent humans ⇒ 8 verifications, 5 burned on BudgetExhausted
    it('on-chain budget for 3 claims, 8 concurrent humans ⇒ verify ≤ 3_RTFINDING', async () => {
      const s = await stack(21n, 3n * 500_000n);
      const verify = vi.spyOn(s.deps.adapters.personhood, 'verify');
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => s.claim(`rt-anvil-${i}`)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(verify.mock.calls.length).toBeLessThanOrEqual(3);
    }, 60_000);

    // RT-FINDING RT-A-12: the self-run facilitator's relayer account has no nonce manager and no send queue
    // (deps.ts selfRun; eip3009 createViemRelayer); two concurrent settlements race for one relayer nonce and the loser
    // answers 402 settle_unavailable — a paying user is refused (not charged) whenever another payment is in flight
    it('two concurrent real top-ups (two payers) on the self-run facilitator ⇒ both served_RTFINDING', async () => {
      const s = await stack(22n, 5n * 500_000n);
      const { url, req } = await s.toppable('rt-anvil-topup');
      const headers = await Promise.all(
        [anvilRoles.human, anvilRoles.stranger].map((r) =>
          paymentHeader(anvilKeys[r], req, { now: Date.now() }),
        ),
      );
      const results = await Promise.all(
        headers.map((h) => s.app.request(url, { headers: { 'PAYMENT-SIGNATURE': h } })),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200]);
    }, 60_000);

    // RT-FINDING RT-A-12 (griefing form): anyone can occupy the relayer nonce through the PUBLIC /facilitator/settle with
    // a 1-unit authorization to our payTo, at the moment a real buyer pays
    it('a 1-unit /facilitator/settle racing a real top-up never makes the top-up fail_RTFINDING', async () => {
      const s = await stack(23n, 5n * 500_000n);
      const { url, req } = await s.toppable('rt-anvil-grief');
      const victim = await paymentHeader(anvilKeys[anvilRoles.human], req, { now: Date.now() });
      const tiny = { ...req, amount: '1' };
      const griefHeader = await paymentHeader(anvilKeys[anvilRoles.stranger], tiny, {
        now: Date.now(),
      });
      const paymentPayload = JSON.parse(Buffer.from(griefHeader, 'base64').toString()) as unknown;
      const [g, v] = await Promise.all([
        s.post('/facilitator/settle', {
          x402Version: 2,
          paymentPayload,
          paymentRequirements: tiny,
        }),
        s.app.request(url, { headers: { 'PAYMENT-SIGNATURE': victim } }),
      ]);
      expect(g.status).toBe(200);
      expect(v.status).toBe(200);
    }, 60_000);
  },
);
