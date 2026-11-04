/** Red-team seeding through the real API (the sponsor console's own path), shared by the rt-* specs. */
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

import { ANVIL_MNEMONIC, API_URL, RPC_URL } from '../../e2e/env';

export const reader = createPublicClient({ chain: foundry, transport: http(RPC_URL) });

/** Registers a campaign named `name` from Anvil #3 (the demo sponsor wallet) — the console's own path. */
export async function seedCampaign(name: string): Promise<Hex> {
  const sponsor = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 3 });
  const wallet = createWalletClient({ account: sponsor, chain: foundry, transport: http(RPC_URL) });
  const budget = 10_000_000n;
  const id =
    `0x${sponsor.address.slice(2).toLowerCase()}00000000${(BigInt(Date.now()) * 7n).toString(16).padStart(16, '0').slice(-16)}` as Hex;
  await reader.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: anvil.usdc as Address,
      abi: parseAbi(['function approve(address,uint256) returns (bool)']),
      functionName: 'approve',
      args: [anvil.dataDrop as Address, budget],
    }),
  });
  const block = await reader.getBlock();
  const expiresAtS = block.timestamp + 86_400n * 10n;
  await reader.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: anvil.dataDrop as Address,
      abi: DataDropAbi as Abi,
      functionName: 'createCampaign',
      args: [id, budget, 500_000n, 120, expiresAtS],
    }),
  });
  const issuedAt = Math.max(Date.now(), Number((await reader.getBlock()).timestamp) * 1000);
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
        name,
        bundleMb: { orb: 300, document: 150, device: 0 },
        pricePerClaimUsd6: '500000',
        maxClaims: 20,
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
    headers: { 'x-forwarded-for': '198.18.7.1' },
  });
  return id;
}
