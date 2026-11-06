/**
 * What a PWA / wallet does against the API, for the in-process tests and scripts/e2e-flow.ts alike: EIP-3009 exact
 * payloads (domain from accepts[].extra, A-21) and the four EIP-712 Recharge messages, signed with viem.
 */
import { toBytes, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { keccak256, randomBytes, bytesToHex } from '@ethglobal/crypto';
import {
  domainFromRequirements,
  fromPaymentAuthorization,
  typedDataTransferWithAuthorization,
} from '@ethglobal/eip3009';
import type { Hex } from '@ethglobal/protocol/ids';
import type {
  PaymentPayload,
  PaymentRequirements,
  TopUpPolicyWire,
} from '@ethglobal/protocol/schemas';
import {
  AGENT_POLICY_TYPES,
  CANCEL_PLAN_TYPES,
  canonicalJson,
  GIFT_CLAIM_TYPES,
  GIFT_RECLAIM_TYPES,
  rechargeDomain,
  SPONSOR_CARDS_TYPES,
  SPONSOR_LOGIN_TYPES,
} from '@ethglobal/protocol/typed-data';
import { encodePaymentPayload, sessionNonce } from '@ethglobal/protocol/x402';

export interface PayOptions {
  /** ms clock; validBefore = now + 300 s. */
  now: number;
  /** The EIP-3009 nonce; `sessionPubKey` binds it (T-32); default random. */
  nonce?: Hex;
  sessionPubKey?: Hex;
  value?: string;
  to?: string;
}

export async function exactPayment(
  key: Hex,
  req: PaymentRequirements,
  opts: PayOptions,
): Promise<PaymentPayload> {
  const account = privateKeyToAccount(key);
  const nonce =
    opts.nonce ??
    (opts.sessionPubKey
      ? sessionNonce(opts.sessionPubKey, keccak256)
      : bytesToHex(randomBytes(32)));
  const authorization = {
    from: account.address,
    to: opts.to ?? req.payTo,
    value: opts.value ?? req.amount,
    validAfter: '0',
    validBefore: String(Math.floor(opts.now / 1000) + 300),
    nonce,
  };
  const signature = await account.signTypedData(
    typedDataTransferWithAuthorization(
      domainFromRequirements(req),
      fromPaymentAuthorization(authorization),
    ),
  );
  return { x402Version: 2, accepted: req, payload: { signature, authorization } };
}

export const paymentHeader = async (
  key: Hex,
  req: PaymentRequirements,
  opts: PayOptions,
): Promise<string> => encodePaymentPayload(await exactPayment(key, req, opts));

export const addressOf = (key: Hex): Address => privateKeyToAccount(key).address;

export async function signGiftClaim(
  key: Hex,
  chainId: number,
  m: { giftId: Hex; namehash: Hex; nonce: Hex },
): Promise<Hex> {
  const account = privateKeyToAccount(key);
  return account.signTypedData({
    domain: rechargeDomain(chainId),
    types: GIFT_CLAIM_TYPES,
    primaryType: 'GiftClaim',
    message: {
      giftId: m.giftId,
      namehash: m.namehash,
      recipient: account.address,
      audience: 'recharge',
      nonce: m.nonce,
    },
  });
}

export async function signGiftReclaim(
  key: Hex,
  chainId: number,
  m: { giftId: Hex; nonce: Hex },
): Promise<Hex> {
  const account = privateKeyToAccount(key);
  return account.signTypedData({
    domain: rechargeDomain(chainId),
    types: GIFT_RECLAIM_TYPES,
    primaryType: 'GiftReclaim',
    message: { giftId: m.giftId, payer: account.address, nonce: m.nonce },
  });
}

export async function signCancelPlan(
  key: Hex,
  chainId: number,
  m: { entitlementKey: string; nonce: Hex; issuedAt: number },
): Promise<Hex> {
  const account = privateKeyToAccount(key);
  return account.signTypedData({
    domain: rechargeDomain(chainId),
    types: CANCEL_PLAN_TYPES,
    primaryType: 'CancelPlan',
    message: {
      entitlementKey: m.entitlementKey,
      payer: account.address,
      nonce: m.nonce,
      issuedAt: BigInt(m.issuedAt),
    },
  });
}

export async function sponsorLogin(
  key: Hex,
  chainId: number,
  campaignId: Hex,
  issuedAt: number,
): Promise<{ sponsor: Address; issuedAt: number; signature: Hex }> {
  const account = privateKeyToAccount(key);
  const signature = await account.signTypedData({
    domain: rechargeDomain(chainId),
    types: SPONSOR_LOGIN_TYPES,
    primaryType: 'SponsorLogin',
    message: { campaignId, sponsor: account.address, issuedAt: BigInt(issuedAt) },
  });
  return { sponsor: account.address, issuedAt, signature };
}

export async function sponsorAuthorization(
  key: Hex,
  chainId: number,
  campaignId: Hex,
  issuedAt: number,
): Promise<string> {
  const login = await sponsorLogin(key, chainId, campaignId, issuedAt);
  return `Recharge-Sponsor ${Buffer.from(JSON.stringify(login)).toString('base64')}`;
}

/** The body of POST /sponsor/:id/cards: `SponsorCards` signed by `key` (A-43, the sponsor's write credential). */
export async function sponsorCardsRequest(
  key: Hex,
  chainId: number,
  campaignId: Hex,
  o: { count: number; mb: number; issuedAt: number; nonce?: Hex },
) {
  const account = privateKeyToAccount(key);
  const nonce =
    o.nonce ?? `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
  const signature = await account.signTypedData({
    domain: rechargeDomain(chainId),
    types: SPONSOR_CARDS_TYPES,
    primaryType: 'SponsorCards',
    message: {
      campaignId,
      sponsor: account.address,
      count: BigInt(o.count),
      mb: BigInt(o.mb),
      nonce,
      issuedAt: BigInt(o.issuedAt),
    },
  });
  return {
    count: o.count,
    mb: o.mb,
    auth: { sponsor: account.address, nonce, issuedAt: o.issuedAt, signature },
  };
}

export async function agentPolicyPut(
  key: Hex,
  chainId: number,
  entitlementKey: string,
  policy: TopUpPolicyWire,
  issuedAt: number,
) {
  const account = privateKeyToAccount(key);
  const policyHash = keccak256(toBytes(canonicalJson(policy)));
  const signature = await account.signTypedData({
    domain: rechargeDomain(chainId),
    types: AGENT_POLICY_TYPES,
    primaryType: 'AgentPolicy',
    message: { entitlementKey, owner: account.address, policyHash, issuedAt: BigInt(issuedAt) },
  });
  return { entitlementKey, owner: account.address, policy, issuedAt, signature };
}

/** sponsor (20 bytes) ‖ 0x00000000 ‖ salt (8 bytes): DataDrop.scopedCampaignId (RT-C-02). */
export const scopedCampaignId = (sponsor: string, salt: bigint): Hex =>
  `0x${sponsor.slice(2).toLowerCase()}00000000${salt.toString(16).padStart(16, '0')}`;
