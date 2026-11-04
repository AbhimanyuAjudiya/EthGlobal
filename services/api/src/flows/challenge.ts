/** consumeChallenge for the routes that consume their own challenge (gift claim, card redeem, reclaim, intents). */
import { consumeChallenge, type Challenge, type ConsumeResult } from '@ethglobal/octroi';
import { AUDIENCE, type ChallengePath, type Hex } from '@ethglobal/protocol/ids';

import { fail } from '../errors.js';

import type { Deps } from '../deps.js';

/** ConsumeResult → the error a client sees (AP2: replay 409, expired 410, forged/rebound 401, ledger 503). */
export async function consume(
  deps: Deps,
  ch: Challenge,
  path: ChallengePath,
  sessionPubKey: Hex,
): Promise<void> {
  if (ch.path !== path || ch.audience !== AUDIENCE)
    throw fail('invalid_proof', { detail: 'challenge_route' });
  const result: ConsumeResult = await consumeChallenge(
    deps.octroi.ledger,
    deps.nonceCache,
    ch,
    sessionPubKey,
    deps.now(),
    deps.secret,
  );
  switch (result) {
    case 'ok':
      return;
    case 'replayed':
      throw fail('replay', { detail: 'challenge' });
    case 'expired':
      throw fail('expired', { detail: 'challenge_expired' });
    case 'invalid':
      throw fail('invalid_proof', { detail: 'challenge_invalid' });
    case 'unavailable':
      throw fail('ledger_unavailable', { detail: 'nonce' });
  }
}
