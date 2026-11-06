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
  utf8,
} from '@ethglobal/crypto';
import {
  entitlementIndex,
  giftEntitlementKey,
  holderHash,
  remainingCampaignClaims,
  type Entitlement,
} from '@ethglobal/octroi';
import type { Found } from '@ethglobal/octroi/store';
import { RechargeError } from '@ethglobal/protocol/errors';
import {
  AUDIENCE,
  GIFT_CLAIM_WINDOW_S,
  isEvmNetwork,
  keys,
  type Hex,
} from '@ethglobal/protocol/ids';
import { generatePin, isValidPin, serialFromGiftId } from '@ethglobal/protocol/pin';
import type {
  EntitledResponse,
  Gift,
  GiftResponse,
  SettleResult,
} from '@ethglobal/protocol/schemas';
import { GIFT_CLAIM_TYPES, rechargeDomain } from '@ethglobal/protocol/typed-data';

import { ChainRevert } from '../chain.js';
import { fail } from '../errors.js';
import { campaignState, pendingCampaignClaims } from '../middleware/octroi.js';
import { signedBy } from '../signatures.js';
import { claimOnChain } from './entitle.js';
import { deliveryMetadata, deliveryRecoveryHash, fulfil } from './fulfil.js';
import { assertConfiguredCapacity } from './plan.js';
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

/**
 * After serve-paid on POST /gift: the escrow, its receipt and HCS; the PIN appears once, in this response.
 * `paid.nonce` is `paymentNonce()` (the EIP-3009 nonce, or sha256 of the Hedera transaction id); it only names the
 * escrow — giftId = keccak256(payer ‖ nonce), the payer as address bytes on EVM and as UTF-8 (`0.0.x`) on Hedera.
 */
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
  const { payer, network } = paid.settlement;
  const giftId = keccak256(
    concat(
      isEvmNetwork(network) ? hexToBytes(payer.toLowerCase() as Hex) : utf8(payer),
      hexToBytes(paid.nonce),
    ),
  );
  const purchases = deps.state.map<{ gift: Gift; pin: string }>('gift-purchases');
  const resumed = purchases.get(giftId);
  const pin = resumed?.pin ?? generatePin(randomBytes);
  const claimBy = resumed?.gift.claimBy ?? now + input.claimWindowMs;
  const gift: Gift = resumed?.gift ?? {
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
  purchases.set(giftId, { gift, pin }, claimBy);
  if (!(await escrowOf(deps, giftId))) await deps.stores.gifts.create(gift);
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

export interface MintedCard {
  giftId: Hex;
  serial: string;
  pin: string;
  mb: number;
  claimBy: number;
}

/**
 * One campaign-funded scratch card (a card escrow, no payment; DataDrop.claim runs at redemption). The PIN is
 * returned once and only its HMAC is stored. Callers: the MODE=local seed hook (X-Seed-Card-Campaign, T-85) and the
 * sponsor-signed POST /sponsor/:id/cards (A-43).
 */
export async function mintCard(
  deps: Deps,
  campaignId: Hex,
  mb: number,
  claimBy: number,
): Promise<MintedCard> {
  const now = deps.now();
  const giftId = bytesToHex(randomBytes(32));
  const pin = generatePin(randomBytes);
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

/** Local-only seed (X-Seed-Card-Campaign, T-85): a campaign-funded scratch card, no payment. */
export const seedCard = (
  deps: Deps,
  campaignId: Hex,
  mb: number,
  claimWindowMs: number,
): Promise<MintedCard> => mintCard(deps, campaignId, mb, deps.now() + claimWindowMs);

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
 * Claim or redeem one escrow: per-giftId mutex → campaign-funded cards reserve capacity and claim on DataDrop →
 * markClaimed (idempotent for our key) → the gift-claim/card-redeem receipt (durable, BEFORE delivery; a failure here is a 503 and no LPA) →
 * the once-only delivery marker → fulfil() → HCS. A gift whose entitlement exists, or whose LPA was already handed
 * out (even if that entitlement has since expired, RT-A-06), refuses a different holder. An authenticated retry
 * with its original private recovery token and session receives only metadata, then recovers ciphertext via /delivery.
 */
export async function claimEscrow(
  deps: Deps,
  escrow: Found<Gift>,
  ctx: { nonce: Hex; sessionPubKey: Hex; redeem: boolean; pin?: string; recoveryKey?: string },
): Promise<{ status: 201 | 202; body: EntitledResponse }> {
  const gift = escrow.payload;
  const giftId = gift.giftId as Hex;
  const key = giftEntitlementKey(deps.secret, giftId);
  const delivered = giftDeliveredKey(deps, giftId);
  const recoveryKeyHash = deliveryRecoveryHash(deps, ctx.recoveryKey);
  const refuse = () => fail(ctx.redeem ? 'expired' : 'already_claimed');
  return deps.mutex.run(`gift:${giftId.toLowerCase()}`, async () => {
    if (gift.state === 'claimed' && gift.claimedKey !== entitlementIndex(key)) throw refuse();
    const existing = await deps.stores.entitlements.getByKey(key);
    const delivery = deps.pendingDelivery.get(key);
    const sameHolder =
      delivery?.recoveryKeyHash !== undefined &&
      recoveryKeyHash === delivery.recoveryKeyHash &&
      delivery.sessionPubKey === ctx.sessionPubKey;
    if (existing) {
      if (!sameHolder) throw refuse();
      return deliveryMetadata(existing, delivery?.context);
    }
    if (await deps.stores.claims.held(delivered)) {
      if (!delivery?.entitlement || !delivery.context || !sameHolder) throw refuse();
      await fulfil(deps, delivery.entitlement, delivery.context);
      const recovered = await deps.stores.entitlements.getByKey(key);
      if (!recovered) throw fail('ledger_unavailable');
      return deliveryMetadata(recovered, delivery.context);
    }
    await assertConfiguredCapacity(deps, gift.mb);
    const markClaimed = async () => {
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
    };
    let claimTx: Hex | undefined;
    let claimKey: Hex | undefined;
    if (gift.fundedBy === 'campaign' && gift.campaignId !== undefined) {
      if (ctx.pin === undefined)
        throw fail('unauthorized', { detail: 'campaign cards redeem by PIN' });
      const campaignId = gift.campaignId.toLowerCase() as Hex;
      claimKey = keccak256(
        concat(hexToBytes(campaignId), hexToBytes(hmacKey(deps.secret, 'card', ctx.pin))),
      );
      const cardClaimKey = claimKey;
      // gift → campaign is the only nested lock order here. Keep the card open until its claim is mined,
      // and replace its open-card promise with the mined counter before another mint/free claim can read it.
      claimTx = await deps.mutex.run(`campaign:${campaignId}`, async () => {
        // Recovery of this exact mined claim consumes no new campaign capacity, even after pause/cap/expiry.
        if (await deps.dataDrop.claimed(campaignId, cardClaimKey)) {
          const tx = await deps.dataDrop.claimTransaction?.(campaignId, cardClaimKey);
          if (!tx)
            throw fail('chain_unavailable', {
              detail: 'claimed card transaction is not yet available',
            });
          deps.pendingCardClaims.delete(cardClaimKey);
          await markClaimed();
          return tx;
        }
        const mark = deps.admission.mark();
        const pending = await pendingCampaignClaims(deps, campaignId, cardClaimKey);
        const { campaign, counters } = await campaignState(deps, campaignId);
        if (!campaign || !counters) throw fail('not_found');
        if (counters.paused) throw fail('campaign_paused');
        if (campaign.expiresAt <= deps.now()) throw fail('campaign_expired');
        const claimsLeft = Math.max(0, remainingCampaignClaims(campaign, counters) - pending);
        const hourLeft = campaign.claimsPerHour - counters.claimsThisHour;
        const release = deps.admission.take(campaignId, Math.min(claimsLeft, hourLeft), 0, mark);
        if (!release) {
          if (claimsLeft <= hourLeft) throw fail('budget_exhausted');
          throw fail('hourly_cap', {
            retryAfterS: Math.ceil((3_600_000 - (deps.now() % 3_600_000)) / 1000),
          });
        }
        const priorPending = deps.pendingCardClaims.get(cardClaimKey);
        try {
          // Persist before sending: an ambiguous transaction may mine after this card's claim window ends.
          deps.pendingCardClaims.set(
            cardClaimKey,
            { campaignId, claimKey: cardClaimKey, giftId, expiresAt: campaign.expiresAt },
            campaign.expiresAt,
          );
          const tx = await claimOnChain(deps, campaignId, cardClaimKey, release);
          deps.pendingCardClaims.delete(cardClaimKey);
          await markClaimed();
          return tx;
        } catch (error) {
          // A failed retry does not resolve an earlier uncertain send of the same claim.
          if (error instanceof ChainRevert && priorPending === undefined)
            deps.pendingCardClaims.delete(cardClaimKey);
          throw error;
        } finally {
          release();
        }
      });
    } else {
      await markClaimed();
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
      holderHash: holderHash(key, ctx.sessionPubKey),
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
    const context = {
      nonce: ctx.nonce,
      sessionPubKey: ctx.sessionPubKey,
      ...(recoveryKeyHash === undefined ? {} : { recoveryKeyHash }),
      ...(claimTx === undefined ? {} : { claimTx }),
      hcs: ctx.redeem
        ? {
            t: 'card-redeem' as const,
            giftId,
            claimKey: claimKey ?? sha256Hex(key),
            tx: claimTx ?? '',
          }
        : { t: 'gift-claim' as const, giftId },
    };
    deps.pendingDelivery.set(
      key,
      {
        sessionPubKey: ctx.sessionPubKey,
        nonce: ctx.nonce,
        entitlement,
        context,
        ...(recoveryKeyHash === undefined ? {} : { recoveryKeyHash }),
      },
      entitlement.expiresAt,
    );
    const until = Math.max(gift.claimBy, entitlement.expiresAt);
    if (!(await deps.stores.claims.reserve(delivered, 'once', until))) throw refuse();
    const result = await fulfil(deps, entitlement, context);
    return result;
  });
}

export const claimWindowMs = (): number => GIFT_CLAIM_WINDOW_S * 1000;
