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

/** DataDrop lets the sponsor refund `budget − spent` after `expiresAt`, or 24 h after pausing (T-06). */
export const REFUND_GRACE_MS = 24 * 60 * 60 * 1000;

export interface CampaignOnChain {
  budget: bigint;
  spent: bigint;
  pricePerClaim: bigint;
  /** ms */
  expiresAt: number;
  /** ms; 0 while unpaused */
  pausedSince: number;
  paused: boolean;
}

/** `campaigns(id)` from DataDrop through the wallet's reader; throws when the answer is not a campaign struct. */
export async function readCampaignOnChain(wallet: Wallet, id: Hex): Promise<CampaignOnChain> {
  const raw: unknown = await wallet.reader.readContract({
    address: dataDropAddress(),
    abi: DATADROP,
    functionName: 'campaigns',
    args: [id],
  });
  const o = raw as Partial<
    Record<'budget' | 'spent' | 'pricePerClaim' | 'expiresAt' | 'pausedSince', bigint>
  > & { paused?: boolean };
  if (
    !o ||
    typeof o !== 'object' ||
    typeof o.expiresAt !== 'bigint' ||
    typeof o.pausedSince !== 'bigint'
  )
    throw new Error('campaign read failed');
  return {
    budget: o.budget ?? 0n,
    spent: o.spent ?? 0n,
    pricePerClaim: o.pricePerClaim ?? 0n,
    expiresAt: Number(o.expiresAt) * 1000,
    pausedSince: Number(o.pausedSince) * 1000,
    paused: o.paused === true,
  };
}

/** When the refund opens: `undefined` = now; else the earlier of the expiry and pause + 24 h (expiry alone while unpaused). */
export function refundOpensAt(c: CampaignOnChain, nowMs: number): number | undefined {
  if (nowMs >= c.expiresAt) return undefined;
  const byPause = c.paused && c.pausedSince > 0 ? c.pausedSince + REFUND_GRACE_MS : undefined;
  if (byPause !== undefined && nowMs >= byPause) return undefined;
  return byPause !== undefined ? Math.min(byPause, c.expiresAt) : c.expiresAt;
}

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

interface SavedCampaign {
  id: string;
  name: string;
  owner: string;
  network?: string;
  contract?: string;
}

/** Scoped ids encode the creator; old browser records have no trustworthy chain information. */
export const campaignOwner = (id: string): string | undefined =>
  /^0x[0-9a-f]{40}00000000[0-9a-f]{16}$/i.test(id) ? id.slice(0, 42).toLowerCase() : undefined;

export const sponsorScope = (owner: string, network: string, contract: string): string =>
  `${network}:${contract.toLowerCase()}:${owner.toLowerCase()}`;

function savedCampaigns(key: string): SavedCampaign[] {
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (
      !row ||
      typeof row !== 'object' ||
      !('id' in row) ||
      !('name' in row) ||
      typeof row.id !== 'string' ||
      typeof row.name !== 'string'
    )
      return [];
    const owner = campaignOwner(row.id);
    if (
      !owner ||
      ('owner' in row && (typeof row.owner !== 'string' || row.owner.toLowerCase() !== owner))
    )
      return [];
    return [
      {
        id: row.id.toLowerCase(),
        name: row.name,
        owner,
        ...('network' in row && typeof row.network === 'string' ? { network: row.network } : {}),
        ...('contract' in row && typeof row.contract === 'string'
          ? { contract: row.contract }
          : {}),
      },
    ];
  });
}

/** Wallet/deployment-scoped convenience list; the API remains the authoritative record. */
export const myCampaigns = {
  list(owner: string, network: string, contract: string): SavedCampaign[] {
    try {
      const rows = [
        ...savedCampaigns(`${LIST}:${sponsorScope(owner, network, contract)}`),
        ...savedCampaigns(LIST),
      ];
      const seen = new Set<string>();
      return rows.filter((row) => {
        if (
          row.owner !== owner.toLowerCase() ||
          seen.has(row.id) ||
          (row.network !== undefined && row.network !== network) ||
          (row.contract !== undefined && row.contract.toLowerCase() !== contract.toLowerCase())
        )
          return false;
        seen.add(row.id);
        return true;
      });
    } catch {
      return [];
    }
  },
  add(entry: SavedCampaign & { network: string; contract: string }) {
    try {
      if (campaignOwner(entry.id) !== entry.owner.toLowerCase()) return;
      localStorage.setItem(
        `${LIST}:${sponsorScope(entry.owner, entry.network, entry.contract)}`,
        JSON.stringify(
          [
            entry,
            ...myCampaigns
              .list(entry.owner, entry.network, entry.contract)
              .filter((c) => c.id.toLowerCase() !== entry.id.toLowerCase()),
          ].slice(0, 100),
        ),
      );
    } catch {
      // per-viewer convenience only
    }
  },
};
