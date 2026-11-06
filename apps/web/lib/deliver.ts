/**
 * One delivery path for every lane that returns `entitledResponseSchema` (/claim, /esim/provision,
 * /gift/claim, /card/redeem): open the sealed LPA with the in-memory session key (zeroised inside
 * openDelivery), keep the LPA (one at a time) and the key in IndexedDB, make the plan this device's current one,
 * record the issuing facts /plan replays once.
 */
import type { SealedBox } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type { EntitledResponse } from '@ethglobal/protocol/schemas';

import { api } from './api';
import { isLpa } from './lpa-links';
import {
  completeSession,
  decryptDelivery,
  persistSession,
  restoreSession,
  sessionPublicKey,
} from './session-key';
import { get, set, del, plans, type IssuedFacts } from './store';

export async function deliver(
  res: EntitledResponse,
  nonce: Hex,
  facts: Omit<IssuedFacts, 'arkivKey'>,
  publicKey = sessionPublicKey(),
): Promise<string> {
  const key = res.entitlementKey;
  // the claiming session's PUBLIC key proves the holder on the first agent-policy PUT (A-35); never the secret
  if (!publicKey) throw new Error('The activation session is unavailable.');
  await plans.saveHolder(key, publicKey);
  await persistSession(publicKey, res.expiresAt);
  await set(`delivery:${key}`, { publicKey, nonce });
  // the person just claimed or bought this plan on this device: it becomes the one /install acts on
  await plans.adopt(key);
  await plans.saveIssued(key, {
    ...facts,
    arkivKey: res.receipt.arkivKey,
    ...(res.claimTx ? { claimTx: res.claimTx } : {}),
    ...(res.settlement?.success ? { settlement: res.settlement.transaction } : {}),
    ...(res.receipt.hcs ? { hcs: res.receipt.hcs } : {}),
  });
  if (res.sealedLpa) await saveActivation(key, publicKey, nonce, res.sealedLpa as SealedBox);
  return key;
}

export const planHref = (key: string) => `/plan/${encodeURIComponent(key)}`;

async function saveActivation(
  key: string,
  publicKey: Hex,
  nonce: Hex,
  box: SealedBox,
): Promise<void> {
  if (!(await restoreSession(publicKey)))
    throw new Error('The activation session is unavailable on this device.');
  const lpa = decryptDelivery(box, nonce, key, publicKey);
  if (!isLpa(lpa)) throw new Error('The provider returned an invalid activation code.');
  const persisted = await plans.saveLpa(key, lpa);
  if (persisted) {
    await completeSession(publicKey);
    await del(`delivery:${key}`);
  }
}

/** Retrieves only ciphertext for this device's original session; a copied plan URL is insufficient. */
export async function recoverActivation(key: string): Promise<boolean> {
  if (await plans.lpa(key)) return true;
  const pending = await get<{ publicKey: Hex; nonce: Hex }>(`delivery:${key}`);
  if (!pending || !(await restoreSession(pending.publicKey))) return false;
  const response = await api.delivery(key, pending.publicKey);
  if (response.status !== 'ready') return false;
  await saveActivation(
    key,
    pending.publicKey,
    response.nonce as Hex,
    response.sealedLpa as SealedBox,
  );
  return true;
}
