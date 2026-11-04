/**
 * The no-payment lanes: a scratch card / gift PIN (/card/redeem, /gift/claim) and a gift claim signed by the
 * recipient's wallet (EIP-712 GiftClaim, T-53). Each takes a fresh challenge bound to a fresh session key and
 * delivers through `deliver` (the sealed LPA opens with that key, then the key is zeroised).
 */
import { namehash, type Address } from 'viem';

import type { Hex } from '@ethglobal/protocol/ids';
import { GIFT_CLAIM_TYPES, GIFT_RECLAIM_TYPES, rechargeDomain } from '@ethglobal/protocol/typed-data';

import { api } from './api';
import { deliver } from './deliver';
import { config } from './env';
import { beginSession } from './session-key';

import type { Wallet } from './wallet';

export async function redeemPin(pin: string, route: '/card/redeem' | '/gift/claim'): Promise<string> {
  const spk = beginSession();
  const challenge = await api.challenge(route, spk);
  const res =
    route === '/card/redeem'
      ? await api.redeemCard({ pin, challenge, sessionPubKey: spk })
      : await api.giftClaim({ pin, challenge, sessionPubKey: spk });
  return deliver(res.data, challenge.nonce as Hex, { you: '$0.00' });
}

export async function claimGiftBySignature(wallet: Wallet, giftId: Hex, name: string): Promise<string> {
  const spk = beginSession();
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
  const res = await api.giftClaim({
    giftId,
    signature,
    recipient: wallet.address,
    challenge,
    sessionPubKey: spk,
  });
  return deliver(res.data, challenge.nonce as Hex, { you: '$0.00' });
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
