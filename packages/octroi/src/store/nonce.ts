/** NonceStore: consumed challenges (INTERFACES §1.4; T-20, T-45). Written on consume, never on issue. */
import type { Ledger } from '@ethglobal/adapters';
import { ANN, CHALLENGE_TTL_S, keys, type Hex } from '@ethglobal/protocol/ids';
import { nonceSchema, type NoncePayload } from '@ethglobal/protocol/schemas';

import { lower, Repo, type Codec } from './common.js';

import type { Challenge } from '../challenge.js';

const nonceCodec: Codec<NoncePayload> = {
  type: 'nonce',
  schema: nonceSchema,
  key: (n) => keys.nonce(n.nonce as Hex),
  annotations: (n) => ({ [ANN.nonce]: lower(n.nonce) }),
  expiresIn: () => CHALLENGE_TTL_S,
};

export class NonceStore {
  readonly #repo: Repo<NoncePayload>;

  constructor(ledger: Ledger, now: () => number) {
    this.#repo = new Repo(ledger, now, nonceCodec);
  }

  /**
   * True when a live nonce entity exists for this key. Any live row counts, even a malformed one: a replay
   * check fails closed.
   */
  async consumed(nonce: Hex): Promise<boolean> {
    return this.#repo.exists(keys.nonce(nonce));
  }

  async consume(c: Challenge, now: number): Promise<void> {
    await this.#repo.create({
      v: 1,
      nonce: c.nonce.toLowerCase(),
      audience: c.audience,
      path: c.path,
      exp: c.exp,
      consumedAt: now,
    });
  }
}
