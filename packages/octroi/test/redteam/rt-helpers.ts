/** Shared red-team helpers (on top of ../helpers.ts; nothing here duplicates @ethglobal/adapters/testing). */
import { InMemoryLedger, type Ledger } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';
import type { PaymentPayload } from '@ethglobal/protocol/schemas';

import {
  challenge,
  consumeChallenge,
  decide,
  type ConsumeResult,
  type Decision,
} from '../../src/index.js';
import { ledgerWith, resource, SECRET, SPK, type TestDeps } from '../helpers.js';

/** A ledger that yields to the event loop on every call, as a networked adapter (Arkiv RPC) does. */
export const networked = (base: Ledger): Ledger => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return ledgerWith(base, {
    put: async (i) => (await tick(), base.put(i)),
    query: async (q) => (await tick(), base.query(q)),
    update: async (k, p, e) => (await tick(), base.update(k, p, e)),
  });
};

/**
 * Consume a /claim challenge on a fresh cache, move the server clock, consume it again on ANOTHER fresh cache
 * (a second API instance / a restart) against the same ledger. Returns the second result.
 */
export async function freshCacheReplay(opts: {
  ledgerNow: (serverNow: number) => number;
  issueAt: (serverNow: number) => number;
  then: (clock: ReturnType<typeof fakeClock>, exp: number) => void;
}): Promise<ConsumeResult> {
  const clock = fakeClock();
  const ledger = new InMemoryLedger({ now: () => opts.ledgerNow(clock.now()) });
  const c = challenge('recharge', '/claim', SPK, opts.issueAt(clock.now()), SECRET);
  const first = await consumeChallenge(ledger, new Set(), c, SPK, clock.now(), SECRET);
  if (first !== 'ok') throw new Error(`setup: first consume was ${first}`);
  opts.then(clock, c.exp);
  return consumeChallenge(ledger, new Set(), c, SPK, clock.now(), SECRET);
}

/** The same paid request twice, concurrently. */
export const concurrentPaid = (d: TestDeps, payment: PaymentPayload): Promise<Decision[]> =>
  Promise.all([
    decide({ resource, mb: 100, payment }, d),
    decide({ resource, mb: 100, payment }, d),
  ]);

/** Deps whose rail keeps the real verify but answers settle with `result`. */
export const settlingWith = (d: TestDeps, result: unknown): TestDeps => ({
  ...d,
  payments: {
    ...d.payments,
    verify: d.payments.verify.bind(d.payments),
    settle: async () => result as Awaited<ReturnType<TestDeps['payments']['settle']>>,
  },
});
