/**
 * The sponsor's own transactions (from the sponsor's wallet, never the API's keys): USDC approve,
 * DataDrop.createCampaign, pause, refund — plus the EIP-712 SponsorLogin the API checks on POST /sponsor and
 * GET /sponsor/:id. ABIs from @ethglobal/contracts/abi; the address from NEXT_PUBLIC_DATADROP_ADDRESS, which
 * next.config.ts fills from deploy/addresses.anvil.json in MODE=local (never imported here: the file is git-ignored
 * and must stay out of a live bundle, RT-W-12).
 */
import { bytesToHex, encodeFunctionData, parseAbi, type Abi, type Address } from 'viem';

import DataDropAbi from '@ethglobal/contracts/abi/DataDrop.json';
import type { Hex } from '@ethglobal/protocol/ids';
import {
  canonicalTicketRefs,
  rechargeDomain,
  sponsorTicketsHash,
  SPONSOR_LOGIN_TYPES,
  SPONSOR_TICKETS_TYPES,
} from '@ethglobal/protocol/typed-data';

import { config } from './env';
import { chainNow, type Wallet } from './wallet';

const DATADROP = DataDropAbi as Abi;
const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const FUNDING = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function isAssociated() view returns (bool)',
  'function associate() returns (int64)',
]);

export const isHederaSponsorChain = (chainId: number): boolean =>
  chainId === 295 || chainId === 296;
export interface SponsorFunding {
  token: Address;
  associated: boolean;
  balance: bigint;
}

/** HIP-719 isAssociated() checks msg.sender: always include the sponsor as eth_call's account. */
export async function readSponsorFunding(wallet: Wallet): Promise<SponsorFunding> {
  if (!isHederaSponsorChain(wallet.chainId)) throw new Error('Not a Hedera sponsor network');
  const token = await usdcAddress(wallet);
  const associated = await wallet.reader.readContract({
    address: token,
    abi: FUNDING,
    functionName: 'isAssociated',
    account: wallet.address,
  });
  const balance = associated
    ? await wallet.reader.readContract({
        address: token,
        abi: FUNDING,
        functionName: 'balanceOf',
        args: [wallet.address],
      })
    : 0n;
  return { token, associated, balance };
}

export const associateUsdcCall = (token: Address) => ({
  to: token,
  data: encodeFunctionData({ abi: FUNDING, functionName: 'associate' }),
});

/** HTS token facades use a long-zero address. EVM account aliases must never be converted this way. */
export const htsTokenId = (token: Address): string | undefined =>
  /^0x0{24}[0-9a-f]{16}$/i.test(token) ? `0.0.${BigInt(token).toString()}` : undefined;

export function dataDropAddress(): Address {
  const address = config.dataDropAddress;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address))
    throw new Error(
      process.env.NEXT_PUBLIC_MODE === 'local'
        ? 'DataDrop address is not configured: run `pnpm dev:chain`, then rebuild or restart the web app'
        : 'DataDrop address is not configured',
    );
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

/** Private ticket passes require a specific write signature; dashboard read credentials are insufficient. */
export async function sponsorTicketsRequest(wallet: Wallet, campaignId: Hex, refs: string[]) {
  const ticketRefs = canonicalTicketRefs(refs);
  const ticketsHash = await sponsorTicketsHash(ticketRefs);
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const issuedAt = await chainNow(wallet);
  const signature = await wallet.signTypedData({
    domain: rechargeDomain(config.chainId),
    types: SPONSOR_TICKETS_TYPES,
    primaryType: 'SponsorTickets',
    message: {
      campaignId,
      sponsor: wallet.address,
      ticketsHash,
      nonce,
      issuedAt: BigInt(issuedAt),
    },
  });
  return { ticketRefs, auth: { sponsor: wallet.address, nonce, issuedAt, signature } };
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
      localStorage.setItem(
        LIST,
        JSON.stringify(
          [entry, ...myCampaigns.list().filter((c) => c.id !== entry.id)].slice(0, 20),
        ),
      );
    } catch {
      // per-viewer convenience only
    }
  },
};
