/**
 * One delivery path for every lane that returns `entitledResponseSchema` (/claim, /esim/provision,
 * /gift/claim, /card/redeem): open the sealed LPA with the in-memory session key (zeroised inside
 * openDelivery), keep the LPA (one at a time) and the key in IndexedDB, make the plan this device's current one,
 * record the issuing facts /plan replays once.
 */
import type { SealedBox } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type { EntitledResponse } from '@ethglobal/protocol/schemas';

import { isLpa } from './lpa-links';
import { endSession, openDelivery, sessionPublicKey } from './session-key';
import { plans, type IssuedFacts } from './store';

export async function deliver(
  res: EntitledResponse,
  nonce: Hex,
  facts: Omit<IssuedFacts, 'arkivKey'>,
): Promise<string> {
  const key = res.entitlementKey;
  // the claiming session's PUBLIC key proves the holder on the first agent-policy PUT (A-35); never the secret
  const holder = sessionPublicKey();
  if (holder) await plans.saveHolder(key, holder);
  if (res.sealedLpa) {
    const lpa = openDelivery(res.sealedLpa as SealedBox, nonce, key);
    if (isLpa(lpa)) await plans.saveLpa(key, lpa);
  } else {
    endSession();
  }
  // the person just claimed or bought this plan on this device: it becomes the one /install acts on
  await plans.adopt(key);
  await plans.saveIssued(key, {
    ...facts,
    arkivKey: res.receipt.arkivKey,
    ...(res.claimTx ? { claimTx: res.claimTx } : {}),
    ...(res.settlement?.success ? { settlement: res.settlement.transaction } : {}),
  });
  return key;
}

export const planHref = (key: string) => `/plan/${encodeURIComponent(key)}`;
