/**
 * Red-team verification variant for RT-A-03 (budget-aware admission before verify, BudgetExhausted/CampaignPaused
 * retryable after verify), through the real API on Anvil (buildDeps, X402_FACILITATOR=self, the deployed DataDrop):
 * budget for 3 claims, 12 concurrent humans of MIXED tiers (orb, document, device), and the sponsor's on-chain
 * `pause(id, true)` racing the burst. Properties:
 *   - at most 3 orb/document humans are verified (none for a claim the budget cannot pay; a device-tier human may be
 *     verified on a released slot — it is offered the paid lane, not a free claim);
 *   - no verification is burned: every verified orb/document human is either served (201) or holds a T-24 intent;
 *   - after unpause, every intent holder completes with the same proof (no re-proving) and total serves ≤ 3.
 * Skipped without Foundry or forge artefacts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anvilAccounts, anvilKeys, anvilRoles, fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

import { anvilReady, startChain, type Chain } from './rt-support.js';
import { createApp } from '../../src/app.js';
import { buildDeps } from '../../src/deps.js';
import { createLogger } from '../../src/logger.js';
import { storedCampaign } from '../support/campaign.js';
import { scopedCampaignId } from '../support/client.js';

const sponsor = anvilAccounts[anvilRoles.sponsor];
const sponsorKey = anvilKeys[anvilRoles.sponsor];
const PRICE = 500_000n;
let chain: Chain;
let ipN = 0;

type Level = 'orb' | 'document' | 'device';

async function stack(salt: bigint, claims: bigint) {
  const id = scopedCampaignId(sponsor, salt);
  await chain.call(sponsorKey, chain.usdc, 'MockUSDC3009', 'approve', [
    chain.dataDrop,
    claims * PRICE,
  ]);
  const end = (await chain.now()) + 86_400;
  await chain.call(sponsorKey, chain.dataDrop, 'DataDrop', 'createCampaign', [
    id,
    claims * PRICE,
    PRICE,
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
      name: 'Anvil RT verify',
      maxClaims: 20,
      claimsPerHour: 100,
      contract: chain.dataDrop,
      createdAt: Date.now(),
      expiresAt: end * 1000,
    }),
  );
  const verified: Level[] = [];
  const p = deps.adapters.personhood;
  const original = p.verify.bind(p);
  p.verify = async (...args: Parameters<typeof original>) => {
    const r = await original(...args);
    verified.push(r.level as Level);
    return r;
  };
  const app = createApp(deps);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.18.2.${++ipN % 250}` },
      body: JSON.stringify(body),
    });
  const human = (level: Level, seed: string) => {
    const spk = bytesToHex(generateSessionKeypair().publicKey);
    let proof: unknown;
    const attempt = async () => {
      const ch = (await (
        await post('/challenge', { audience: 'recharge', path: '/claim', sessionPubKey: spk })
      ).json()) as { signal: Hex };
      proof ??= fixtureProof(level, ch.signal, seed); // a retry resends the FIRST proof (one-time)
      return post('/claim', { proof, campaignId: id, challenge: ch, sessionPubKey: spk });
    };
    return { level, spk, attempt };
  };
  const pause = (paused: boolean) =>
    chain.call(sponsorKey, chain.dataDrop, 'DataDrop', 'pause', [id, paused]);
  return { deps, human, pause, verified };
}

describe.skipIf(!anvilReady)('verify RT-A-03: mixed tiers + a concurrent pause on Anvil', () => {
  beforeAll(async () => {
    chain = await startChain();
  }, 60_000);
  afterAll(() => chain?.stop());

  it.each([0, 1, 2, 3])(
    'budget 3, 12 mixed-tier humans, pause racing the burst (round %i) ⇒ verify ≤ 3, nothing burned, retries complete',
    async (round) => {
      const s = await stack(90n + BigInt(round), 3n);
      const levels: Level[] = [
        'orb',
        'document',
        'device',
        'orb',
        'document',
        'orb',
        'device',
        'orb',
        'document',
        'orb',
        'device',
        'orb',
      ];
      const humans = levels.map((l, i) => s.human(l, `verify-a03-${round}-${i}`));
      const [results] = await Promise.all([
        Promise.all(humans.map((h) => h.attempt())),
        new Promise((r) => setTimeout(r, [0, 60, 400, 1_500][round])).then(() => s.pause(true)),
      ]);
      const statuses = results.map((r) => r.status);
      const served = statuses.filter((x) => x === 201).length;
      // a device-tier human takes a slot, is verified, gets the paid lane (402) and releases it: not a free claim
      const freeVerified = s.verified.filter((l) => l !== 'device').length;
      expect(freeVerified).toBeLessThanOrEqual(3);
      expect(served).toBeLessThanOrEqual(3);
      // nothing burned: verified-but-unserved free humans all hold an intent
      const holders = humans.filter(
        (h, i) => statuses[i] !== 201 && s.deps.intents.get(h.spk.toLowerCase()),
      );
      expect(served + holders.length).toBeGreaterThanOrEqual(freeVerified);

      await s.pause(false);
      const verifiedBefore = s.verified.length;
      const retried = await Promise.all(holders.map((h) => h.attempt()));
      for (const r of retried) expect(r.status).toBe(201);
      // a retry resumes the stored decision; the mock may re-check the proof but no NEW human is verified
      expect(served + retried.length).toBeLessThanOrEqual(3);
      expect(s.verified.length - verifiedBefore).toBeLessThanOrEqual(holders.length);
    },
    90_000,
  );
});
