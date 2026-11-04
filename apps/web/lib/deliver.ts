/**
 * One delivery path for every lane that returns `entitledResponseSchema` (/claim, /esim/provision,
 * /gift/claim, /card/redeem): open the sealed LPA with the in-memory session key (zeroised inside
 * openDelivery), keep the LPA and the key in IndexedDB, record the issuing facts /plan replays once.
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
  await plans.add(key);
  await plans.saveIssued(key, {
    ...facts,
    arkivKey: res.receipt.arkivKey,
    ...(res.claimTx ? { claimTx: res.claimTx } : {}),
    ...(res.settlement?.success ? { settlement: res.settlement.transaction } : {}),
  });
  return key;
}

export const planHref = (key: string) => `/plan/${encodeURIComponent(key)}`;
