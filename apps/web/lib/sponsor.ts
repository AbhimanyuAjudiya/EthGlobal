/**
 * The sponsor's own transactions (from the sponsor's wallet, never the API's keys): USDC approve,
 * DataDrop.createCampaign, pause, refund — plus the EIP-712 SponsorLogin the API checks on POST /sponsor and
 * GET /sponsor/:id. ABIs from @ethglobal/contracts/abi; addresses from NEXT_PUBLIC_DATADROP_ADDRESS or, in
 * MODE=local, deploy/addresses.anvil.json.
 */
import { encodeFunctionData, parseAbi, type Abi, type Address } from 'viem';

import DataDropAbi from '@ethglobal/contracts/abi/DataDrop.json';
import anvilAddresses from '@ethglobal/contracts/addresses/anvil.json';
import type { Hex } from '@ethglobal/protocol/ids';
import { rechargeDomain, SPONSOR_LOGIN_TYPES } from '@ethglobal/protocol/typed-data';

import { config } from './env';
import { chainNow, type Wallet } from './wallet';

const DATADROP = DataDropAbi as Abi;
const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);

export function dataDropAddress(): Address {
  const address =
    config.dataDropAddress ||
    (process.env.NEXT_PUBLIC_MODE === 'local' ? anvilAddresses.dataDrop : '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('DataDrop address is not configured');
  return address as Address;
}

/** sponsor (20 bytes) ‖ 0x00000000 ‖ salt (8 bytes) — DataDrop.scopedCampaignId (RT-C-02). */
export const scopedCampaignId = (sponsor: Address, salt: bigint): Hex =>
  `0x${sponsor.slice(2).toLowerCase()}00000000${salt.toString(16).padStart(16, '0')}`;

export async function usdcAddress(wallet: Wallet): Promise<Address> {
  return (await wallet.reader.readContract({
    address: dataDropAddress(),
    abi: DATADROP,
    functionName: 'usdc',
  })) as Address;
}

export const approveCall = (budget: bigint) => ({
  data: encodeFunctionData({
    abi: ERC20,
    functionName: 'approve',
    args: [dataDropAddress(), budget],
  }),
});

export const createCampaignCall = (
  id: Hex,
  budget: bigint,
  pricePerClaim: bigint,
  claimsPerHour: number,
  expiresAtS: bigint,
) => ({
  to: dataDropAddress(),
  data: encodeFunctionData({
    abi: DATADROP,
    functionName: 'createCampaign',
    args: [id, budget, pricePerClaim, claimsPerHour, expiresAtS],
  }),
});

export const pauseCall = (id: Hex, paused: boolean) => ({
  to: dataDropAddress(),
  data: encodeFunctionData({ abi: DATADROP, functionName: 'pause', args: [id, paused] }),
});

export const refundCall = (id: Hex) => ({
  to: dataDropAddress(),
  data: encodeFunctionData({ abi: DATADROP, functionName: 'refund', args: [id] }),
});

/** EIP-712 SponsorLogin{campaignId, sponsor, issuedAt} over rechargeDomain(chain); valid 1 h (T-72). */
export async function sponsorLogin(wallet: Wallet, campaignId: Hex) {
  const issuedAt = await chainNow(wallet);
  const signature = await wallet.signTypedData({
    domain: rechargeDomain(config.chainId),
    types: SPONSOR_LOGIN_TYPES,
    primaryType: 'SponsorLogin',
    message: { campaignId, sponsor: wallet.address, issuedAt: BigInt(issuedAt) },
  });
  return { sponsor: wallet.address, issuedAt, signature };
}

const LIST = 'recharge.sponsor.campaigns';

/** Campaign ids this browser created (per-viewer convenience; the API is the record). */
export const myCampaigns = {
  list(): { id: string; name: string }[] {
    try {
      return JSON.parse(localStorage.getItem(LIST) ?? '[]') as { id: string; name: string }[];
    } catch {
      return [];
    }
  },
  add(entry: { id: string; name: string }) {
    try {
      localStorage.setItem(LIST, JSON.stringify([entry, ...myCampaigns.list()].slice(0, 20)));
    } catch {
      // per-viewer convenience only
    }
  },
};
