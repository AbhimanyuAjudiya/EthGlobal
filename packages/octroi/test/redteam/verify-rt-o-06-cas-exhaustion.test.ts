/**
 * Red-team verification variant for RT-O-06 (compare-and-swap with CAS_ATTEMPTS = 8 re-reads, A-32): drive the retry
 * limit to exhaustion with a rival writer that bumps the entity's version between every read and write. Properties:
 *   - exhaustion surfaces as a conflict — never a silent success, never a partial write;
 *   - exactly CAS_ATTEMPTS conditional writes are attempted, no more;
 *   - a gift stays claimable by exactly one key: N concurrent different-key claims ⇒ ≤ 1 fulfilled, and the stored
 *     claimedKey is that winner's (a loser that exhausted never wrote);
 *   - relative (function) patches under heavy contention: final mbTotal == base + number of fulfilled patches.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryLedger, type Ledger } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';
import { keys } from '@ethglobal/protocol/ids';

import { CAS_ATTEMPTS } from '../../src/store/common.js';
import { EntitlementStore, GiftStore } from '../../src/store/index.js';
import { entitlement, gift, GIFT_ID, ledgerWith } from '../helpers.js';
import { networked } from './rt-helpers.js';

const KEY = `ent:v1:0x${'e6'.repeat(32)}`;

/** Before every conditional update, a rival re-writes the same entity unconditionally (version + 1), `rounds` times. */
function contended(base: InMemoryLedger, rounds: number): Ledger & { casWrites: number } {
  let left = rounds;
  const l = ledgerWith(base, {
    update: async (k, p, e) => {
      if (p.ifVersion !== undefined) {
        out.casWrites += 1;
        if (left > 0) {
          left -= 1;
          const cur = await base.get(k);
          if (cur) await base.update(k, { payload: cur.payload, annotations: cur.annotations });
        }
      }
      return base.update(k, p, e);
    },
  });
  const out = Object.assign(l, { casWrites: 0 });
  return out;
}

describe('verify RT-O-06: compare-and-swap retry limit driven to exhaustion', () => {
  it('CAS_ATTEMPTS is 8 (the limit this file exhausts)', () => {
    expect(CAS_ATTEMPTS).toBe(8);
  });

  it('markClaimed vs a rival that wins every one of 8 rounds ⇒ conflict, gift still open, exactly 8 CAS writes', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    const ledger = contended(base, CAS_ATTEMPTS);
    const gifts = new GiftStore(ledger, clock.now);
    await gifts.create(gift());
    await expect(gifts.markClaimed(GIFT_ID, 'giftent:exhausted')).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(ledger.casWrites).toBe(CAS_ATTEMPTS);
    const row = await new GiftStore(base, clock.now).bySerial(gift().serial);
    expect(row?.payload.state).toBe('open');
    expect(row?.payload.claimedKey).toBeUndefined();
    // the next claimer, uncontended, gets the gift
    await new GiftStore(base, clock.now).markClaimed(GIFT_ID, 'giftent:next');
    expect((await new GiftStore(base, clock.now).bySerial(gift().serial))?.payload.claimedKey).toBe(
      'giftent:next',
    );
  });

  it('7 lost rounds, the 8th attempt wins ⇒ success with the change applied once', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    const ledger = contended(base, CAS_ATTEMPTS - 1);
    const store = new EntitlementStore(ledger, clock.now);
    await store.create(entitlement({ key: KEY, mbTotal: 300, mbUsed: 0 }));
    await store.patch(KEY, (e) => ({ mbTotal: e.mbTotal + 100 }));
    expect(ledger.casWrites).toBe(CAS_ATTEMPTS);
    expect((await new EntitlementStore(base, clock.now).getByKey(KEY))?.payload.mbTotal).toBe(400);
  });

  it('patch exhausted ⇒ conflict and no write (the row is unchanged)', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    const store = new EntitlementStore(contended(base, 1_000), clock.now);
    await store.create(entitlement({ key: KEY, mbTotal: 300, mbUsed: 0 }));
    await expect(store.patch(KEY, (e) => ({ mbTotal: e.mbTotal + 100 }))).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await new EntitlementStore(base, clock.now).getByKey(KEY))?.payload.mbTotal).toBe(300);
  });

  it('32 concurrent markClaimed with different keys on a networked ledger ⇒ ≤ 1 fulfilled, stored key is the winner', async () => {
    for (let round = 0; round < 20; round += 1) {
      const clock = fakeClock();
      const base = new InMemoryLedger({ now: clock.now });
      const gifts = new GiftStore(networked(base), clock.now);
      await gifts.create(gift());
      const ids = Array.from({ length: 32 }, (_, i) => `giftent:r${round}-${i}`);
      const rs = await Promise.allSettled(ids.map((k) => gifts.markClaimed(GIFT_ID, k)));
      const won = ids.filter((_, i) => rs[i]!.status === 'fulfilled');
      expect(won.length).toBeLessThanOrEqual(1);
      for (const r of rs) {
        if (r.status === 'rejected') {
          expect(['already_claimed', 'conflict']).toContain((r.reason as { code?: string }).code);
        }
      }
      const stored = (await new GiftStore(base, clock.now).bySerial(gift().serial))?.payload;
      if (won.length === 1) expect(stored?.claimedKey).toBe(won[0]);
      else expect(stored?.state).toBe('open');
    }
  });

  it('64 concurrent +100 MB function patches ⇒ final mbTotal == 300 + 100 × fulfilled (no lost or phantom top-up)', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    const store = new EntitlementStore(networked(base), clock.now);
    await store.create(entitlement({ key: KEY, mbTotal: 300, mbUsed: 0 }));
    const rs = await Promise.allSettled(
      Array.from({ length: 64 }, () => store.patch(KEY, (e) => ({ mbTotal: e.mbTotal + 100 }))),
    );
    const ok = rs.filter((r) => r.status === 'fulfilled').length;
    for (const r of rs) {
      if (r.status === 'rejected') expect((r.reason as { code?: string }).code).toBe('conflict');
    }
    expect((await new EntitlementStore(base, clock.now).getByKey(KEY))?.payload.mbTotal).toBe(
      300 + 100 * ok,
    );
  });

  it('the gift key used by markClaimed is the logical gift key (control)', () => {
    expect(keys.gift(GIFT_ID)).toContain(GIFT_ID.slice(2, 10));
  });
});
