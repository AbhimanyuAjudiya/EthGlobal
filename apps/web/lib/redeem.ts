/**
 * The no-payment lanes: a scratch card / gift PIN (/card/redeem, /gift/claim) and a gift claim signed by the
 * recipient's wallet (EIP-712 GiftClaim, T-53). Retries use a fresh challenge with the original encrypted
 * session and private recovery token, so a lost response cannot strand the activation.
 */
import { namehash, type Address } from 'viem';

import { sha256Hex } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import {
  GIFT_CLAIM_TYPES,
  GIFT_RECLAIM_TYPES,
  rechargeDomain,
} from '@ethglobal/protocol/typed-data';

import { api } from './api';
import { deliver, recoverActivation } from './deliver';
import { config } from './env';
import { buildProof } from './proof';
import { beginSession, persistSession, restoreSession } from './session-key';
import { get, set, del } from './store';

import type { Wallet } from './wallet';

interface Redemption {
  publicKey: Hex;
  recoveryToken: string;
}
const preparing = new Map<string, Promise<Redemption>>();
const pinOperation = (pin: string, route: '/card/redeem' | '/gift/claim') =>
  `redemption:${sha256Hex(`${route}:${pin}`)}`;

/** Store only a digest/identifier and an encrypted session key, never a card or gift PIN. */
async function redemptionSession(operation: string): Promise<Redemption> {
  const active = preparing.get(operation);
  if (active) return active;
  const prepare = async () => {
    const saved = await get<Redemption>(operation);
    if (saved?.recoveryToken && (await restoreSession(saved.publicKey))) return saved;
    const publicKey = beginSession();
    await persistSession(publicKey);
    const pending = { publicKey, recoveryToken: crypto.randomUUID() };
    await set(operation, pending);
    return pending;
  };
  // Two tabs starting the same claim must not overwrite one another's recovery identity.
  const pending = (async () =>
    typeof navigator !== 'undefined' && navigator.locks
      ? await navigator.locks.request(operation, prepare)
      : await prepare())();
  preparing.set(operation, pending);
  try {
    return await pending;
  } finally {
    preparing.delete(operation);
  }
}

/** Claimed-card recovery is offered only for a pending attempt saved by this device. */
export async function hasPendingCardRedemption(pin: string): Promise<boolean> {
  const saved = await get<Redemption>(pinOperation(pin, '/card/redeem'));
  return !!saved?.recoveryToken && (await restoreSession(saved.publicKey));
}

export async function finishRedemption(
  operation: string,
  key: string,
  needsRecovery: boolean,
): Promise<string> {
  // A same-holder retry returns metadata only; the delivery endpoint supplies the original AAD nonce.
  if (needsRecovery) await recoverActivation(key).catch(() => false);
  await del(operation);
  return key;
}

/** A new proof is still required; only the delivery identity survives a lost response. */
export async function prepareFreeClaim(campaignId?: string) {
  const operation = `redemption:claim:${campaignId ?? 'default'}`;
  const { publicKey: spk, recoveryToken } = await redemptionSession(operation);
  return { spk, recoveryToken, operation, challenge: await api.challenge('/claim', spk) };
}

export async function redeemPin(
  pin: string,
  route: '/card/redeem' | '/gift/claim',
): Promise<string> {
  const operation = pinOperation(pin, route);
  const { publicKey: spk, recoveryToken } = await redemptionSession(operation);
  const challenge = await api.challenge(route, spk);
  const res =
    route === '/card/redeem'
      ? await api.redeemCard({ pin, challenge, sessionPubKey: spk }, recoveryToken)
      : await api.giftClaim({ pin, challenge, sessionPubKey: spk }, recoveryToken);
  const key = await deliver(
    res.data,
    challenge.nonce as Hex,
    {
      you: '$0.00',
      proof: buildProof({ response: res.data, status: res.status }),
    },
    spk,
  );
  return finishRedemption(operation, key, res.status === 201 && !res.data.sealedLpa);
}

export async function claimGiftBySignature(
  wallet: Wallet,
  giftId: Hex,
  name: string,
): Promise<string> {
  const operation = `redemption:gift:${giftId.toLowerCase()}:${wallet.address.toLowerCase()}`;
  const { publicKey: spk, recoveryToken } = await redemptionSession(operation);
  const challenge = await api.challenge('/gift/claim', spk);
  const signature = await wallet.signTypedData({
    domain: rechargeDomain(config.chainId),
    types: GIFT_CLAIM_TYPES,
    primaryType: 'GiftClaim',
    message: {
      giftId,
      namehash: namehash(name),
      recipient: wallet.address,
      audience: 'recharge',
      nonce: challenge.nonce,
    },
  });
  const res = await api.giftClaim(
    {
      giftId,
      signature,
      recipient: wallet.address,
      challenge,
      sessionPubKey: spk,
    },
    recoveryToken,
  );
  const key = await deliver(
    res.data,
    challenge.nonce as Hex,
    {
      you: '$0.00',
      // the name the gift was sent to and the wallet that proved it holds it
      proof: buildProof({
        response: res.data,
        status: res.status,
        ens: { name, address: wallet.address },
      }),
    },
    spk,
  );
  return finishRedemption(operation, key, res.status === 201 && !res.data.sealedLpa);
}

/** The /gift/reclaim challenge "session key" is the payer address left-padded to 32 bytes (api README #4). */
export const payerSessionKey = (payer: Address): Hex =>
  `0x${payer.slice(2).toLowerCase().padStart(64, '0')}`;

export async function reclaimGift(wallet: Wallet, giftId: Hex) {
  const challenge = await api.challenge('/gift/reclaim', payerSessionKey(wallet.address));
  const signature = await wallet.signTypedData({
    domain: rechargeDomain(config.chainId),
    types: GIFT_RECLAIM_TYPES,
    primaryType: 'GiftReclaim',
    message: { giftId, payer: wallet.address, nonce: challenge.nonce },
  });
  return (await api.giftReclaim({ giftId, payer: wallet.address, signature, challenge })).data;
}
