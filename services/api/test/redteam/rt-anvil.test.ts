/**
 * Red team wave 2 (unscripted), real Anvil: the RT-A-03 budget burst through buildDeps(X402_FACILITATOR=self) against
 * the deployed DataDrop, and RT-A-12 — concurrent real EIP-3009 settlements through the self-run relayer.
 * Skipped without Foundry or forge artefacts. RT-A-03/12 are fixed: their attack tests are passing regressions named
 * `… [RT-A-NN]`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
    storedCampaign({
      id,
      sponsor,
      name: 'Anvil RT',
      maxClaims: 20,
      claimsPerHour: 100,
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
    const url = `/esim/topup?key=${encodeURIComponent(entitlementKey)}&mb=1000`;
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

    // regression RT-A-03 (Anvil, fixed): the budget-aware admission refuses the 5 losers before verify
    it('on-chain budget for 3 claims, 8 concurrent humans ⇒ verify ≤ 3 [RT-A-03]', async () => {
      const s = await stack(21n, 3n * 500_000n);
      const verify = vi.spyOn(s.deps.adapters.personhood, 'verify');
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => s.claim(`rt-anvil-${i}`)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(verify.mock.calls.length).toBeLessThanOrEqual(3);
    }, 60_000);

    // regression RT-A-12 (fixed): the relayer has viem's nonce manager and one SerialQueue (deps.ts serialRelayer)
    it('two concurrent real top-ups (two payers) on the self-run facilitator ⇒ both served [RT-A-12]', async () => {
      const s = await stack(22n, 5n * 500_000n);
      const { url, req } = await s.toppable('rt-anvil-topup');
      const headers = await Promise.all(
        [anvilRoles.human, anvilRoles.stranger].map((r) =>
          paymentHeader(anvilKeys[r], req, { now: Date.now() }),
        ),
      );
      const results = await Promise.all(
        headers.map(async (h) => s.app.request(url, { headers: { 'PAYMENT-SIGNATURE': h } })),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200]);
    }, 60_000);

    // regression RT-A-12 (griefing form, fixed): a dust authorization is refused before the relayer (amount ≥ one
    // step), and a real-sized public settlement racing a buyer is queued behind it, never in its way
    it('a 1-unit /facilitator/settle racing a real top-up never makes the top-up fail [RT-A-12]', async () => {
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
      expect(g.status).toBe(400); // dust is not a sale: refused before any relayer work
      expect(v.status).toBe(200);
      // the strongest public form: a full-price settlement from a stranger, racing a second buyer
      const next = await s.toppable('rt-anvil-grief-2');
      const buyer = await paymentHeader(anvilKeys[anvilRoles.human], next.req, { now: Date.now() });
      const full = await paymentHeader(anvilKeys[anvilRoles.stranger], next.req, {
        now: Date.now(),
      });
      const [g2, v2] = await Promise.all([
        s.post('/facilitator/settle', {
          x402Version: 2,
          paymentPayload: JSON.parse(Buffer.from(full, 'base64').toString()) as unknown,
          paymentRequirements: next.req,
        }),
        s.app.request(next.url, { headers: { 'PAYMENT-SIGNATURE': buyer } }),
      ]);
      expect(g2.status).toBe(200);
      expect(v2.status).toBe(200);
    }, 60_000);
  },
);
