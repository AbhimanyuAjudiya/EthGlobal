/**
 * Gifts and scratch cards (ARCHITECTURE §2.4, A-17): purchase (paid lane → escrow entity whose lifetime IS the
 * claim window), claim by EIP-712 signature of the CURRENTLY resolved address or by PIN, and card redemption
 * (campaign-funded cards claim on DataDrop first). Every claim consumes a challenge before any lookup (T-53) and
 * writes its `gift-claim`/`card-redeem` receipt BEFORE the LPA is delivered (T-71 a).
 */
import { namehash, type Address } from 'viem';

import { normalizeName } from '@ethglobal/adapters';
import {
  bytesToHex,
  concat,
  hexToBytes,
  hmacKey,
  keccak256,
  randomBytes,
  sha256Hex,
} from '@ethglobal/crypto';
import type { Entitlement } from '@ethglobal/octroi';
import type { Found } from '@ethglobal/octroi/store';
import { RechargeError } from '@ethglobal/protocol/errors';
import { AUDIENCE, GIFT_CLAIM_WINDOW_S, keys, type Hex } from '@ethglobal/protocol/ids';
import { generatePin, isValidPin, serialFromGiftId } from '@ethglobal/protocol/pin';
import type {
  EntitledResponse,
  Gift,
  GiftResponse,
  SettleResult,
} from '@ethglobal/protocol/schemas';
import { GIFT_CLAIM_TYPES, rechargeDomain } from '@ethglobal/protocol/typed-data';

import { fail } from '../errors.js';
import { signedBy } from '../signatures.js';
import { claimOnChain } from './entitle.js';
import { fulfil } from './fulfil.js';
import { addReceipt, record } from './record.js';

import type { Deps } from '../deps.js';

export { consume } from './challenge.js';

const DAY_MS = 86_400_000;

/** Resolves an ENS name (ENSIP-15 normalised) or throws 400 (unnormalisable) / 404 name_unresolved (T-43). */
export async function resolveName(
  deps: Deps,
  name: string,
): Promise<{ name: string; to: Address; namehash: Hex }> {
  let normalised: string;
  try {
    normalised = normalizeName(name);
  } catch {
    throw fail('invalid_request', [{ path: 'name', message: 'not a normalisable ENS name' }]);
  }
  const to = await deps.adapters.names.resolve(normalised);
  if (to === null) throw fail('name_unresolved');
  return { name: normalised, to, namehash: namehash(normalised) };
}

/** After serve-paid on POST /gift: the escrow, its receipt and HCS; the PIN appears once, in this response. */
export async function createGift(
  deps: Deps,
  input: {
    name: string;
    to: Address;
    namehash: Hex;
    mb: number;
    message?: string;
    claimWindowMs: number;
  },
  paid: { settlement: Extract<SettleResult, { success: true }>; usd6: string; nonce: Hex },
): Promise<GiftResponse> {
  const now = deps.now();
  const giftId = keccak256(
    concat(hexToBytes(paid.settlement.payer.toLowerCase() as Hex), hexToBytes(paid.nonce)),
  );
  const pin = generatePin(randomBytes);
  const claimBy = now + input.claimWindowMs;
  const gift: Gift = {
    v: 1,
    giftId,
    kind: 'gift',
    state: 'open',
    name: input.name,
    namehash: input.namehash,
    to: input.to,
    mb: input.mb,
    validityDays: deps.env.VALIDITY_DAYS,
    pinKey: hmacKey(deps.secret, 'pin', pin),
    serial: serialFromGiftId(giftId),
    fundedBy: 'payment',
    paidTx: paid.settlement.transaction,
    payer: paid.settlement.payer,
    usd6: paid.usd6,
    network: paid.settlement.network,
    ...(input.message === undefined ? {} : { message: input.message }),
    createdAt: now,
    claimBy,
  };
  await deps.stores.gifts.create(gift);
  const recorded = await record(
    deps,
    keys.gift(giftId),
    {
      kind: 'gift',
      mb: input.mb,
      usd6: paid.usd6,
      network: paid.settlement.network,
      tx: paid.settlement.transaction,
      payer: paid.settlement.payer,
    },
    { t: 'gift', giftId, namehash: input.namehash, mb: input.mb, tx: paid.settlement.transaction },
  );
  return {
    giftId,
    serial: gift.serial,
    pin,
    name: input.name,
    to: input.to,
    mb: input.mb,
    claimBy,
    settlement: paid.settlement,
    receipt: { arkivKey: keys.gift(giftId), ...(recorded.hcs ? { hcs: recorded.hcs } : {}) },
  };
}

/** Local-only seed (X-Seed-Card-Campaign, T-85): a campaign-funded scratch card, no payment. */
export async function seedCard(
  deps: Deps,
  campaignId: Hex,
  mb: number,
  claimWindowMs: number,
): Promise<{ giftId: Hex; serial: string; pin: string; mb: number; claimBy: number }> {
  const now = deps.now();
  const giftId = bytesToHex(randomBytes(32));
  const pin = generatePin(randomBytes);
  const claimBy = now + claimWindowMs;
  await deps.stores.gifts.create({
    v: 1,
    giftId,
    kind: 'card',
    state: 'open',
    to: null,
    mb,
    validityDays: deps.env.VALIDITY_DAYS,
    pinKey: hmacKey(deps.secret, 'pin', pin),
    serial: serialFromGiftId(giftId),
    fundedBy: 'campaign',
    campaignId,
    createdAt: now,
    claimBy,
  });
  return { giftId, serial: serialFromGiftId(giftId), pin, mb, claimBy };
}

/** The live escrow for a giftId (by its public serial; the giftId must match exactly). */
export async function escrowOf(deps: Deps, giftId: Hex): Promise<Found<Gift> | null> {
  const found = await deps.stores.gifts.bySerial(serialFromGiftId(giftId));
  return found?.payload.giftId.toLowerCase() === giftId.toLowerCase() ? found : null;
}

/** EIP-712 GiftClaim by the address the gift's name resolves to NOW (T-43 drift: the new owner claims). */
export async function verifyGiftClaimSigner(
  deps: Deps,
  gift: Gift,
  claim: { giftId: Hex; recipient: string; signature: string; nonce: Hex },
): Promise<void> {
  if (gift.name === undefined || gift.namehash === undefined)
    throw fail('unauthorized', { detail: 'gift has no name; use the PIN' });
  const current = await deps.adapters.names.resolve(gift.name);
  if (current?.toLowerCase() !== claim.recipient.toLowerCase())
    throw fail('unauthorized', { detail: 'recipient is not the resolved address' });
  const ok = await signedBy({
    address: claim.recipient as Address,
    domain: rechargeDomain(deps.chainId),
    types: GIFT_CLAIM_TYPES,
    primaryType: 'GiftClaim',
    message: {
      giftId: claim.giftId,
      namehash: gift.namehash as Hex,
      recipient: claim.recipient as Address,
      audience: AUDIENCE,
      nonce: claim.nonce,
    },
    signature: claim.signature as Hex,
  });
  if (!ok) throw fail('unauthorized', { detail: 'bad GiftClaim signature' });
}

/** PIN → escrow; the same 401 for "no such card" and "wrong PIN" (AP10.5). Verhoeff-invalid ⇒ 400. */
export async function escrowByPin(deps: Deps, pin: string): Promise<Found<Gift>> {
  if (!isValidPin(pin))
    throw fail('invalid_request', [{ path: 'pin', message: 'not a valid card number' }]);
  const found = await deps.stores.gifts.byPinKey(hmacKey(deps.secret, 'pin', pin));
  if (!found) throw fail('unauthorized', { detail: 'unknown card or wrong PIN' });
  return found;
}

/** The ledger's once-only "this gift's LPA was handed out" marker (RT-A-06): an opaque `claim:` HMAC key. */
export const giftDeliveredKey = (deps: Pick<Deps, 'secret'>, giftId: Hex): string =>
  keys.claim(hmacKey(deps.secret, 'gift-delivered', giftId.toLowerCase()));

/**
 * Claim or redeem one escrow: per-giftId mutex → markClaimed (idempotent for our key) → campaign-funded cards claim
 * on DataDrop → the gift-claim/card-redeem receipt (durable, BEFORE delivery; a failure here is a 503 and no LPA) →
 * the once-only delivery marker → fulfil() → HCS. A gift whose entitlement exists, or whose LPA was already handed
 * out (even if that entitlement has since expired, RT-A-06), answers 409 (gift) / 410 (card) on every route.
 */
export async function claimEscrow(
  deps: Deps,
  escrow: Found<Gift>,
  ctx: { nonce: Hex; sessionPubKey: Hex; redeem: boolean; pin?: string },
): Promise<{ status: 201 | 202; body: EntitledResponse }> {
  const gift = escrow.payload;
  const giftId = gift.giftId as Hex;
  const key = keys.entitlementGift(giftId);
  const delivered = giftDeliveredKey(deps, giftId);
  const refuse = () => fail(ctx.redeem ? 'expired' : 'already_claimed');
  return deps.mutex.run(`gift:${giftId.toLowerCase()}`, async () => {
    if (gift.state === 'claimed' && gift.claimedKey !== key) throw refuse();
    if (await deps.stores.entitlements.getByKey(key)) throw refuse();
    if (await deps.stores.claims.held(delivered)) throw refuse();
    try {
      await deps.stores.gifts.markClaimed(giftId, key);
    } catch (error) {
      if (
        error instanceof RechargeError &&
        (error.code === 'not_found' || error.code === 'already_claimed')
      )
        throw fail(error.code === 'not_found' ? 'expired' : 'already_claimed');
      throw error;
    }
    let claimTx: Hex | undefined;
    let claimKey: Hex | undefined;
    if (gift.fundedBy === 'campaign' && gift.campaignId !== undefined) {
      if (ctx.pin === undefined)
        throw fail('unauthorized', { detail: 'campaign cards redeem by PIN' });
      const campaignId = gift.campaignId as Hex;
      claimKey = keccak256(
        concat(hexToBytes(campaignId), hexToBytes(hmacKey(deps.secret, 'card', ctx.pin))),
      );
      // a retry after a failed delivery finds the claim already on-chain and does not claim twice
      if (!(await deps.dataDrop.claimed(campaignId, claimKey)))
        claimTx = await claimOnChain(deps, campaignId, claimKey);
    }
    const now = deps.now();
    const entitlement: Entitlement = {
      v: 1,
      key,
      kind: gift.kind,
      status: 'pending-profile',
      tier: 'none',
      ...(gift.campaignId === undefined ? {} : { campaignId: gift.campaignId }),
      planId: deps.env.RESELLER_PLAN_ID,
      mbTotal: gift.mb,
      mbUsed: 0,
      usageAsOf: now,
      usageSource: 'none',
      createdAt: now,
      expiresAt: now + gift.validityDays * DAY_MS,
    };
    const kind = ctx.redeem ? ('card-redeem' as const) : ('gift-claim' as const);
    // durable intent: the receipt that blocks a reclaim exists before any data is delivered (T-71 a)
    await addReceipt(deps, keys.gift(giftId), {
      key: `rcpt:ledger:${kind}:${giftId.toLowerCase()}`,
      kind,
      mb: gift.mb,
      ...(gift.campaignId === undefined ? {} : { campaignId: gift.campaignId }),
      ...(claimTx === undefined ? {} : { tx: claimTx }),
    }).catch((error: unknown) => {
      if (error instanceof RechargeError && error.code === 'replay') return; // a retry after a failed fulfil
      throw error;
    });
    // one delivery per gift, ever (T-31): taken create-if-absent before the LPA can exist; fail closed — a fulfil
    // that fails after this point leaves the gift delivered-or-pending, never deliverable twice
    const until = Math.max(gift.claimBy, entitlement.expiresAt);
    if (!(await deps.stores.claims.reserve(delivered, 'once', until))) throw refuse();
    const result = await fulfil(deps, entitlement, {
      nonce: ctx.nonce,
      sessionPubKey: ctx.sessionPubKey,
      ...(claimTx === undefined ? {} : { claimTx }),
      hcs: ctx.redeem
        ? { t: 'card-redeem', giftId, claimKey: claimKey ?? sha256Hex(key), tx: claimTx ?? '' }
        : { t: 'gift-claim', giftId },
    });
    return result;
  });
}

export const claimWindowMs = (): number => GIFT_CLAIM_WINDOW_S * 1000;
