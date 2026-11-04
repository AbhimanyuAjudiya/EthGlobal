/**
 * The viem DataDrop client and the local self-run wiring against a real Anvil (skipped when Foundry or the forge
 * artefacts are absent): real claim/claimed/claimsInHour/pause, revert decoding, and buildDeps(X402_FACILITATOR=self)
 * settling a real EIP-3009 transfer on MockUSDC3009.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anvilAccounts, anvilKeys, anvilRoles, fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import { campaignFromPayload } from '@ethglobal/octroi';

import { createApp } from '../src/app.js';
import {
  ChainRevert,
  createDataDropClient,
  decodeRevert,
  type DataDropClient,
} from '../src/chain.js';
import { buildDeps } from '../src/deps.js';
import { createLogger } from '../src/logger.js';
import { paymentHeader, scopedCampaignId } from './support/client.js';

const OUT = new URL('../../../packages/contracts/out/', import.meta.url);
const artefact = (name: string) =>
  JSON.parse(readFileSync(new URL(`${name}.sol/${name}.json`, OUT), 'utf8')) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
const anvilBin = ['/usr/local/bin/anvil', `${process.env.HOME ?? ''}/.foundry/bin/anvil`].find(
  (p) => existsSync(p),
);
const ready = anvilBin !== undefined && existsSync(new URL('DataDrop.sol/DataDrop.json', OUT));
const PORT = 18_545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;

let anvil: ChildProcess | undefined;
let usdc: Address;
let dataDropAddress: Address;
let client: DataDropClient;
const sponsor = anvilAccounts[anvilRoles.sponsor];
const publicClient = createPublicClient({
  chain: foundry,
  pollingInterval: 50,
  transport: http(RPC),
});
const wallet = (key: Hex) =>
  createWalletClient({ chain: foundry, account: privateKeyToAccount(key), transport: http(RPC) });

async function deploy(name: string, args: unknown[]): Promise<Address> {
  const a = artefact(name);
  const hash = await wallet(anvilKeys[0]).deployContract({
    abi: a.abi,
    bytecode: a.bytecode.object,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(`${name} not deployed`);
  return receipt.contractAddress;
}

async function send(
  key: Hex,
  address: Address,
  abi: Abi,
  functionName: string,
  args: unknown[],
): Promise<void> {
  await publicClient.waitForTransactionReceipt({
    hash: await wallet(key).writeContract({ address, abi, functionName, args }),
  });
}

describe.skipIf(!ready)('DataDrop on Anvil', () => {
  const id = scopedCampaignId(sponsor, 7n);
  let expiresAt = 0;

  beforeAll(async () => {
    anvil = spawn(
      anvilBin ?? 'anvil',
      ['--port', String(PORT), '--chain-id', '31337', '--silent'],
      { stdio: 'ignore' },
    );
    for (let i = 0; i < 100; i++) {
      try {
        await publicClient.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    usdc = await deploy('MockUSDC3009', []);
    dataDropAddress = await deploy('DataDrop', [
      usdc,
      anvilAccounts[1],
      anvilAccounts[2],
      anvilAccounts[0],
    ]);
    const usdcAbi = artefact('MockUSDC3009').abi;
    for (const who of [sponsor, anvilAccounts[anvilRoles.human]])
      await send(anvilKeys[0], usdc, usdcAbi, 'mint', [who, 1_000_000_000n]);
    await send(anvilKeys[anvilRoles.sponsor], usdc, usdcAbi, 'approve', [
      dataDropAddress,
      10_000_000n,
    ]);
    const now = Number((await publicClient.getBlock()).timestamp);
    expiresAt = (now + 30 * 86_400) * 1000;
    await send(
      anvilKeys[anvilRoles.sponsor],
      dataDropAddress,
      artefact('DataDrop').abi,
      'createCampaign',
      [id, 10_000_000n, 500_000n, 2, BigInt(now + 30 * 86_400)],
    );
    client = createDataDropClient({
      rpcUrl: RPC,
      chainId: 31337,
      address: dataDropAddress,
      attestorKey: anvilKeys[2],
      confirmations: 1,
      gas: 150_000n,
    });
  }, 60_000);

  afterAll(() => {
    anvil?.kill();
  });

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
    await send(anvilKeys[anvilRoles.sponsor], dataDropAddress, artefact('DataDrop').abi, 'pause', [
      id,
      false,
    ]);
    const dead = createDataDropClient({
      rpcUrl: 'http://127.0.0.1:9',
      chainId: 31337,
      address: dataDropAddress,
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
    await send(anvilKeys[anvilRoles.sponsor], usdc, artefact('MockUSDC3009').abi, 'approve', [
      dataDropAddress,
      10_000_000n,
    ]);
    const now = Number((await publicClient.getBlock()).timestamp);
    await send(
      anvilKeys[anvilRoles.sponsor],
      dataDropAddress,
      artefact('DataDrop').abi,
      'createCampaign',
      [id2, 10_000_000n, 500_000n, 100, BigInt(now + 86_400)],
    );
    const deps = await buildDeps(
      {
        MODE: 'local',
        X402_FACILITATOR: 'self',
        ANVIL_RPC_URL: RPC,
        DATADROP_ADDRESS: dataDropAddress,
        USDC_ADDRESS: usdc,
        LOG_LEVEL: 'silent',
      },
      { logger: createLogger('silent') },
    );
    await deps.stores.campaigns.put(
      campaignFromPayload({
        v: 1,
        id: id2,
        sponsor,
        name: 'Anvil',
        bundleMb: { orb: 300, document: 160, device: 0 },
        pricePerClaimUsd6: '500000',
        maxClaims: 20,
        claimsPerHour: 100,
        validityDays: 7,
        wholesaleUsd6PerGb: '1140000',
        idResaleUsd6: '500000',
        planId: 'in-300mb-7d',
        network: 'eip155:31337',
        contract: dataDropAddress,
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
    const url = `/esim/topup?key=${encodeURIComponent(entitlementKey)}&mb=100`;
    const quote = await app.request(url);
    const required = JSON.parse(
      Buffer.from(quote.headers.get('PAYMENT-REQUIRED') ?? '', 'base64').toString(),
    ) as { accepts: Parameters<typeof paymentHeader>[1][] };
    const block = Number((await publicClient.getBlock()).timestamp) * 1000;
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
    expect(
      (await publicClient.getTransactionReceipt({ hash: settlement.transaction })).status,
    ).toBe('success');
  }, 30_000);
});
