/**
 * The viem DataDrop client and the local self-run wiring against a real Anvil (skipped when Foundry or the forge
 * artefacts are absent): real claim/claimed/claimsInHour/pause, revert decoding, and buildDeps(X402_FACILITATOR=self)
 * settling a real EIP-3009 transfer on MockUSDC3009.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anvilAccounts, anvilKeys, anvilRoles, fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

import { createApp } from '../src/app.js';
import {
  ChainRevert,
  createDataDropClient,
  decodeRevert,
  type DataDropClient,
} from '../src/chain.js';
import { buildDeps } from '../src/deps.js';
import { createLogger } from '../src/logger.js';
import { anvilReady, startChain, type Chain } from './support/anvil.js';
import { storedCampaign } from './support/campaign.js';
import { paymentHeader, scopedCampaignId } from './support/client.js';

let chain: Chain;
let client: DataDropClient;
const sponsor = anvilAccounts[anvilRoles.sponsor];
const sponsorKey = anvilKeys[anvilRoles.sponsor];

describe.skipIf(!anvilReady)('DataDrop on Anvil', () => {
  const id = scopedCampaignId(sponsor, 7n);
  let expiresAt = 0;

  beforeAll(async () => {
    chain = await startChain();
    await chain.call(sponsorKey, chain.usdc, 'MockUSDC3009', 'approve', [
      chain.dataDrop,
      10_000_000n,
    ]);
    const now = await chain.now();
    expiresAt = (now + 30 * 86_400) * 1000;
    await chain.call(sponsorKey, chain.dataDrop, 'DataDrop', 'createCampaign', [
      id,
      10_000_000n,
      500_000n,
      2,
      BigInt(now + 30 * 86_400),
    ]);
    client = createDataDropClient({
      rpcUrl: chain.rpc,
      chainId: 31337,
      address: chain.dataDrop,
      attestorKey: anvilKeys[2],
      confirmations: 1,
      gas: 150_000n,
    });
  }, 60_000);

  afterAll(() => chain?.stop());

  it('reads the campaign and claims once; the second claim reverts AlreadyClaimed; the hour cap reverts HourlyCap', async () => {
    expect(await client.campaign(id)).toMatchObject({
      sponsor,
      pricePerClaim: 500_000n,
      budget: 10_000_000n,
      spent: 0n,
      claimsPerHour: 2,
      paused: false,
      expiresAt,
    });
    const key: Hex = `0x${'11'.repeat(32)}`;
    expect(await client.claimed(id, key)).toBe(false);
    const { tx } = await client.claim(id, key);
    expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await client.claimed(id, key)).toBe(true);
    expect(await client.claimsInHour(id, await client.currentHourBucket())).toBe(1);
    const again = await client.claim(id, key).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(ChainRevert);
    expect(decodeRevert(again)).toBe('AlreadyClaimed');
    await client.claim(id, `0x${'12'.repeat(32)}`);
    expect(
      decodeRevert(await client.claim(id, `0x${'13'.repeat(32)}`).catch((e: unknown) => e)),
    ).toBe('HourlyCap');
  });

  it('pause from the attestor; a claim then reverts CampaignPaused; an unreachable node is ChainUnavailable', async () => {
    await client.pause(id, true);
    expect((await client.campaign(id)).paused).toBe(true);
    expect(
      decodeRevert(await client.claim(id, `0x${'14'.repeat(32)}`).catch((e: unknown) => e)),
    ).toBe('CampaignPaused');
    await chain.call(sponsorKey, chain.dataDrop, 'DataDrop', 'pause', [id, false]);
    const dead = createDataDropClient({
      rpcUrl: 'http://127.0.0.1:9',
      chainId: 31337,
      address: chain.dataDrop,
      attestorKey: anvilKeys[2],
      confirmations: 1,
      gas: 150_000n,
    });
    expect(await dead.campaign(id).catch((e: unknown) => (e as Error).name)).toBe(
      'ChainUnavailable',
    );
    expect(
      await dead.claim(id, `0x${'15'.repeat(32)}`).catch((e: unknown) => (e as Error).name),
    ).toBe('ChainUnavailable');
  });

  it('buildDeps(X402_FACILITATOR=self): claim on chain, then a real MockUSDC3009 transfer for the top-up', async () => {
    const id2 = scopedCampaignId(sponsor, 8n);
    await chain.call(sponsorKey, chain.usdc, 'MockUSDC3009', 'approve', [
      chain.dataDrop,
      10_000_000n,
    ]);
    const now = await chain.now();
    await chain.call(sponsorKey, chain.dataDrop, 'DataDrop', 'createCampaign', [
      id2,
      10_000_000n,
      500_000n,
      100,
      BigInt(now + 86_400),
    ]);
    const deps = await buildDeps(
      {
        MODE: 'local',
        X402_FACILITATOR: 'self',
        ANVIL_RPC_URL: chain.rpc,
        DATADROP_ADDRESS: chain.dataDrop,
        USDC_ADDRESS: chain.usdc,
        LOG_LEVEL: 'silent',
      },
      { logger: createLogger('silent') },
    );
    await deps.stores.campaigns.put(
      storedCampaign({
        id: id2,
        sponsor,
        name: 'Anvil',
        maxClaims: 20,
        claimsPerHour: 100,
        contract: chain.dataDrop,
        createdAt: Date.now(),
        expiresAt: (now + 86_400) * 1000,
      }),
    );
    const app = createApp(deps);
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const spk = bytesToHex(generateSessionKeypair().publicKey);
    const ch = (await (
      await post('/challenge', { audience: 'recharge', path: '/claim', sessionPubKey: spk })
    ).json()) as { signal: Hex };
    const claim = await post('/claim', {
      proof: fixtureProof('orb', ch.signal, 'anvil'),
      campaignId: id2,
      challenge: ch,
      sessionPubKey: spk,
    });
    expect(claim.status).toBe(201);
    const { entitlementKey } = (await claim.json()) as { entitlementKey: string };
    const url = `/esim/topup?key=${encodeURIComponent(entitlementKey)}&mb=1000`;
    const quote = await app.request(url);
    const required = JSON.parse(
      Buffer.from(quote.headers.get('PAYMENT-REQUIRED') ?? '', 'base64').toString(),
    ) as { accepts: Parameters<typeof paymentHeader>[1][] };
    const block = (await chain.now()) * 1000;
    const paid = await app.request(url, {
      headers: {
        'PAYMENT-SIGNATURE': await paymentHeader(
          anvilKeys[anvilRoles.human],
          required.accepts[0]!,
          { now: block },
        ),
      },
    });
    expect(paid.status).toBe(200);
    const settlement = JSON.parse(
      Buffer.from(paid.headers.get('PAYMENT-RESPONSE') ?? '', 'base64').toString(),
    ) as { transaction: Hex };
    expect(await chain.status(settlement.transaction)).toBe('success');
  }, 30_000);
});
