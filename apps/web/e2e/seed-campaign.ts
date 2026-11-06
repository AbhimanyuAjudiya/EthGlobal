/**
 * Registers a sponsor campaign exactly like the sponsor console does — USDC approve + DataDrop.createCampaign from
 * Anvil #3 (the demo sponsor wallet), then POST /sponsor signed with SponsorLogin. Shared by the suite's global setup
 * and the red-team seeds (test/redteam/rt-seed.ts), so both exercise the console's own path.
 */
import { createRequire } from 'node:module';

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

import DataDropAbi from '@ethglobal/contracts/abi/DataDrop.json' with { type: 'json' };
import { httpJson } from '@ethglobal/protocol/http';
import { rechargeDomain, SPONSOR_LOGIN_TYPES } from '@ethglobal/protocol/typed-data';

import { ANVIL_MNEMONIC, API_URL, RPC_URL } from './env';

const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const DAY_S = 86_400n;
/** The API refuses a new campaign paying less per claim than one 1 GB eSIM costs (COST_USD6_PER_CLAIM, $1.20). */
const PRICE_PER_CLAIM = 1_200_000n;
// The deploy record is git-ignored (written by `pnpm dev:chain`): required at run time, never imported, so lint,
// typecheck and `next build` do not need the chain to have run.
const anvil = createRequire(import.meta.url)('@ethglobal/contracts/addresses/anvil.json') as {
  dataDrop: Address;
  usdc: Address;
};

export const chainReader = createPublicClient({ chain: foundry, transport: http(RPC_URL) });

export interface CampaignSeed {
  name: string;
  /** USDC base units locked in DataDrop. */
  budget: bigint;
  maxClaims: number;
  expiresInDays: number;
  /** 8-byte salt of the sponsor-scoped campaign id. */
  salt: bigint;
  /** The API's per-IP limits: each caller seeds from its own documentation-range address. */
  clientIp: string;
}

export async function registerCampaign(seed: CampaignSeed): Promise<Hex> {
  const sponsor = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 3 });
  const wallet = createWalletClient({ account: sponsor, chain: foundry, transport: http(RPC_URL) });
  const id =
    `0x${sponsor.address.slice(2).toLowerCase()}00000000${seed.salt.toString(16).padStart(16, '0').slice(-16)}` as Hex;
  await chainReader.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: anvil.usdc,
      abi: ERC20,
      functionName: 'approve',
      args: [anvil.dataDrop, seed.budget],
    }),
  });
  const expiresAtS = (await chainReader.getBlock()).timestamp + BigInt(seed.expiresInDays) * DAY_S;
  await chainReader.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: anvil.dataDrop,
      abi: DataDropAbi as Abi,
      functionName: 'createCampaign',
      args: [id, seed.budget, PRICE_PER_CLAIM, 120, expiresAtS],
    }),
  });
  const issuedAt = Math.max(Date.now(), Number((await chainReader.getBlock()).timestamp) * 1000);
  const signature = await sponsor.signTypedData({
    domain: rechargeDomain(31337),
    types: SPONSOR_LOGIN_TYPES,
    primaryType: 'SponsorLogin',
    message: { campaignId: id, sponsor: sponsor.address, issuedAt: BigInt(issuedAt) },
  });
  await httpJson(`${API_URL}/sponsor`, {
    body: {
      campaign: {
        id,
        sponsor: sponsor.address,
        name: seed.name,
        bundleMb: { orb: 1000, document: 1000, device: 0 },
        pricePerClaimUsd6: PRICE_PER_CLAIM.toString(),
        maxClaims: seed.maxClaims,
        claimsPerHour: 120,
        validityDays: 7,
        wholesaleUsd6PerGb: '1200000',
        // as the console sends it: at $1.50 the 80 % bundle-EV rule (octroi size.ts, T-23) allows the full 1 GB
        idResaleUsd6: '1500000',
        planId: 'in-1gb-7d',
        network: 'eip155:31337',
        contract: anvil.dataDrop,
        expiresAt: Number(expiresAtS) * 1000,
      },
      auth: { issuedAt, signature },
    },
    headers: { 'x-forwarded-for': seed.clientIp },
  });
  return id;
}
