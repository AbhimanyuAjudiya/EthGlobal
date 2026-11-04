/**
 * ClaimStore: claim locks and settlement markers (A-33; RT-O-03, RT-O-05, RT-O-08). Each is an opaque
 * `claim:` + HMAC key written create-if-absent, so the LEDGER — not one process's memory — decides which of two
 * concurrent claims / serves wins. Nothing here names a human, a campaign or a payment in clear.
 */
import type { Ledger } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { claimSchema, type ClaimLock } from '@ethglobal/protocol/schemas';

import { lifetimeUntil, Repo, type Codec } from './common.js';

const claimCodec: Codec<ClaimLock> = {
  type: 'claim',
  schema: claimSchema,
  key: (c) => c.key,
  annotations: (c) => ({ expiresAt: c.expiresAt }),
  expiresIn: (c, now) => lifetimeUntil(c.expiresAt, now),
};

export class ClaimStore {
  readonly #repo: Repo<ClaimLock>;

  constructor(ledger: Ledger, now: () => number) {
    this.#repo = new Repo(ledger, now, claimCodec);
  }

  /** True when any live row holds this key (decodable or not: a lock check fails closed). */
  held(key: string): Promise<boolean> {
    return this.#repo.exists(key);
  }

  /** Take the lock until `expiresAt`: true if this call took it, false if a live holder exists. */
  async reserve(key: string, scope: ClaimLock['scope'], expiresAt: number): Promise<boolean> {
    try {
      await this.#repo.create({ v: 1, key, scope, expiresAt });
      return true;
    } catch (error) {
      if (error instanceof RechargeError && error.code === 'replay') return false;
      throw error;
    }
  }
}
