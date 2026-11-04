/**
 * Registers a sponsor campaign exactly like the sponsor console does — USDC approve + DataDrop.createCampaign from
 * Anvil #3 (the demo sponsor wallet), then POST /sponsor signed with SponsorLogin. Shared by the suite's global setup
 * and the red-team seeds (test/redteam/rt-seed.ts), so both exercise the console's own path.
 */
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
import anvil from '@ethglobal/contracts/addresses/anvil.json' with { type: 'json' };
import { httpJson } from '@ethglobal/protocol/http';
import { rechargeDomain, SPONSOR_LOGIN_TYPES } from '@ethglobal/protocol/typed-data';

import { ANVIL_MNEMONIC, API_URL, RPC_URL } from './env';

const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const DAY_S = 86_400n;

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
      address: anvil.usdc as Address,
      abi: ERC20,
      functionName: 'approve',
      args: [anvil.dataDrop as Address, seed.budget],
    }),
  });
  const expiresAtS = (await chainReader.getBlock()).timestamp + BigInt(seed.expiresInDays) * DAY_S;
  await chainReader.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: anvil.dataDrop as Address,
      abi: DataDropAbi as Abi,
      functionName: 'createCampaign',
      args: [id, seed.budget, 500_000n, 120, expiresAtS],
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
        bundleMb: { orb: 300, document: 150, device: 0 },
        pricePerClaimUsd6: '500000',
        maxClaims: seed.maxClaims,
        claimsPerHour: 120,
        validityDays: 7,
        wholesaleUsd6PerGb: '1140000',
        idResaleUsd6: '500000',
        planId: 'in-300mb-7d',
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
