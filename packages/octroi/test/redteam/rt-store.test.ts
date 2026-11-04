/**
 * Red team (wave 1, octroi): store-layer attacks (T-35, T-36, T-71, T-79). The tests once filed as
 * findings (RT-O-03, RT-O-06) are passing regressions named `… [RT-O-0N]`. The rest prove what octroi actually relies on from
 * the ledger adapter (the guarantees listed in RT-O-03 and the wave report).
 */
import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { fakeClock, T0 } from '@ethglobal/adapters/testing';
import { ANN, keys, type Hex } from '@ethglobal/protocol/ids';

import { entitlementIndex } from '../../src/index.js';
import {
  AgentPolicyStore,
  EntitlementStore,
  GiftStore,
  NonceStore,
  ReceiptStore,
} from '../../src/store/index.js';
import { entitlement, forge, gift, GIFT_ID, ledgerWith, receipt } from '../helpers.js';
import { networked } from './rt-helpers.js';

const DAY = 86_400_000;
const KEY = `ent:v1:0x${'d1'.repeat(32)}`;

describe('attack: rt store read-modify-write without compare-and-swap', () => {
  // Regression RT-O-06 (fixed)
  it('GiftStore.markClaimed: two concurrent claims of one gift with different entitlement keys → at most one succeeds [RT-O-06]', async () => {
    const clock = fakeClock();
    const ledger = networked(new InMemoryLedger({ now: clock.now }));
    const gifts = new GiftStore(ledger, clock.now);
    await gifts.create(gift());
    const rs = await Promise.allSettled([
      gifts.markClaimed(GIFT_ID, 'giftent:redeemer-a'),
      gifts.markClaimed(GIFT_ID, 'giftent:redeemer-b'),
    ]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  // Property: sequentially, markClaimed is the one-claim lock (idempotent for the same key, refuses another).
  it('GiftStore.markClaimed sequential: same key idempotent, different key already_claimed', async () => {
    const clock = fakeClock();
    const gifts = new GiftStore(new InMemoryLedger({ now: clock.now }), clock.now);
    await gifts.create(gift());
    await gifts.markClaimed(GIFT_ID, 'giftent:a');
    await expect(gifts.markClaimed(GIFT_ID, 'giftent:a')).resolves.toBeUndefined();
    await expect(gifts.markClaimed(GIFT_ID, 'giftent:b')).rejects.toMatchObject({
      code: 'already_claimed',
    });
  });

  // Regression RT-O-06 (fixed)
  it('EntitlementStore.patch: a concurrent usage patch does not erase a paid top-up (lost update) [RT-O-06]', async () => {
    const clock = fakeClock();
    const ledger = networked(new InMemoryLedger({ now: clock.now }));
    const store = new EntitlementStore(ledger, clock.now);
    await store.create(entitlement({ key: KEY, mbTotal: 300, mbUsed: 200 }));
    await Promise.all([
      store.patch(KEY, { mbTotal: 400 }), // top-up path: +100 MB, paid
      store.patch(KEY, { mbUsed: 250, usageAsOf: T0 + 1 }), // webhook path
    ]);
    const after = await store.getByKey(KEY);
    expect(after?.payload).toMatchObject({ mbTotal: 400, mbUsed: 250 });
  });

  // Regression RT-O-03 (fixed)
  it('EntitlementStore.create: two concurrent creates of one logical key → exactly one entity [RT-O-03]', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    const store = new EntitlementStore(networked(base), clock.now);
    await Promise.allSettled([
      store.create(entitlement({ key: KEY, campaignId: `0x${'aa'.repeat(32)}` })),
      store.create(entitlement({ key: KEY, campaignId: `0x${'bb'.repeat(32)}` })),
    ]);
    const rows = await base.query({
      annotations: { [ANN.type]: 'entitlement', [ANN.key]: entitlementIndex(KEY) },
    });
    expect(rows).toHaveLength(1);
    // Before the fix both rows were written and every later read threw internal_error (lock-out until expiry).
    await expect(store.getByKey(KEY)).resolves.not.toBeNull();
  });

  // Property: sequential create of a live duplicate is refused with 'replay'.
  it('sequential duplicate create → replay', async () => {
    const clock = fakeClock();
    const store = new EntitlementStore(new InMemoryLedger({ now: clock.now }), clock.now);
    await store.create(entitlement({ key: KEY }));
    await expect(store.create(entitlement({ key: KEY }))).rejects.toMatchObject({ code: 'replay' });
  });
});

describe('attack: rt forged / conflicting entities (T-79, T-36)', () => {
  // Property (T-79, InMemoryLedger upholds it): another writer's look-alike is invisible — it neither hides,
  // replaces nor duplicates our entitlement, and it cannot plant one where none exists.
  it('a foreign writer cannot shadow, duplicate or plant an entitlement / gift / agent policy', async () => {
    const clock = fakeClock();
    const ours = new InMemoryLedger({ now: clock.now, writer: '0xour-writer' });
    const evil = ours.asWriter('0xattacker');
    const ents = new EntitlementStore(ours, clock.now);
    await ents.create(entitlement({ key: KEY, mbUsed: 10 }));
    const forged = entitlement({ key: KEY, mbUsed: 0, mbTotal: 30_000 });
    await new EntitlementStore(evil, clock.now).create(forged);
    await new EntitlementStore(evil, clock.now).create(
      entitlement({ key: 'paid:0xvictim:0x01', mbTotal: 30_000 }),
    );
    expect((await ents.getByKey(KEY))?.payload.mbUsed).toBe(10);
    expect(await ents.getByKey('paid:0xvictim:0x01')).toBeNull();

    await new GiftStore(evil, clock.now).create(gift());
    expect(await new GiftStore(ours, clock.now).byPinKey(gift().pinKey as Hex)).toBeNull();

    await new AgentPolicyStore(evil, clock.now).put({
      v: 1,
      entitlementKey: KEY,
      owner: `0x${'66'.repeat(20)}`,
      policy: {
        maxUsd6PerDay: '1000000000',
        thresholdMb: 300,
        stepMb: 300,
        paused: false,
        topUpOnExpiry: true,
        expiryLeadS: 86_400,
      },
      updatedAt: T0,
    });
    expect(await new AgentPolicyStore(ours, clock.now).get(KEY)).toBeNull();
  });

  // Property: an entity whose annotations disagree with its payload is dropped on read, and a same-writer
  // duplicate fails closed (internal_error) rather than letting either row win. This is a DoS lever only for
  // whoever holds the writer key — i.e. it is safe exactly as long as the adapter filters $creator.
  it('same-writer conflicting row: mismatched annotation is ignored; second live row ⇒ internal_error (fail closed)', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const ents = new EntitlementStore(ledger, clock.now);
    await ents.create(entitlement({ key: KEY }));
    await forge(
      ledger,
      {
        [ANN.type]: 'entitlement',
        [ANN.key]: entitlementIndex(`${KEY}x`),
        [ANN.expiresAt]: T0 + DAY,
      },
      entitlement({ key: KEY }),
      3600,
    );
    expect(await ents.getByKey(`${KEY}x`)).toBeNull(); // payload says KEY, annotation says KEYx ⇒ dropped
    expect(await ents.getByKey(KEY)).not.toBeNull();
    await forge(
      ledger,
      { [ANN.type]: 'entitlement', [ANN.key]: entitlementIndex(KEY), [ANN.expiresAt]: T0 + DAY },
      'not json',
      3600,
    );
    await expect(ents.getByKey(KEY)).rejects.toMatchObject({ code: 'internal_error' });
  });

  // Property (adapter assumption A-L3 in RT-O-03): the store applies `limit: 2` at the ledger and its own
  // liveness filter after. It is correct only because the adapter drops dead rows (both clocks) BEFORE the limit.
  // A non-conforming adapter that returns annotation-dead rows first hides a live entitlement:
  it('documents the pre-limit liveness assumption: a non-conforming ledger hides a live row (InMemoryLedger does not)', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    const ents = new EntitlementStore(base, clock.now);
    await forge(
      base,
      { [ANN.type]: 'entitlement', [ANN.key]: entitlementIndex(KEY), [ANN.expiresAt]: T0 + 1 },
      entitlement({ key: KEY }),
      3600,
    );
    await forge(
      base,
      { [ANN.type]: 'entitlement', [ANN.key]: entitlementIndex(KEY), [ANN.expiresAt]: T0 + 2 },
      entitlement({ key: KEY }),
      3600,
    );
    clock.advance(10);
    await ents.create(entitlement({ key: KEY, expiresAt: T0 + DAY }));
    expect(await ents.getByKey(KEY)).not.toBeNull(); // conforming adapter: dead rows never reach the limit
    const raw: { payload: string; annotations: Record<string, string | number> }[] = [];
    for (const at of [T0 + 1, T0 + 2]) {
      raw.push({
        payload: JSON.stringify(entitlement({ key: KEY })),
        annotations: {
          [ANN.type]: 'entitlement',
          [ANN.key]: entitlementIndex(KEY),
          [ANN.expiresAt]: at,
        },
      });
    }
    const leaky = ledgerWith(base, {
      query: async (q) =>
        [
          ...raw.map((r, i) => ({
            key: `dead_${i}`,
            createdAt: T0,
            expiresAt: T0 + 3_600_000,
            ...r,
          })),
          ...(await base.query(q)),
        ].slice(0, q?.limit),
    });
    expect(await new EntitlementStore(leaky, clock.now).getByKey(KEY)).toBeNull(); // ← why A-L3 must hold
  });
});

describe('attack: rt expiry semantics at the store (T-35)', () => {
  // Property: patch after annotation expiry never resurrects, even while the ledger still holds the row.
  it('patch on an entity dead by annotation but alive on the ledger → not_found; opts.expiresAt in the past → invalid_request', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const store = new EntitlementStore(ledger, clock.now);
    await store.create(entitlement({ key: KEY, expiresAt: T0 + 1000 }));
    // ledger lifetime is ceil(1 s) — make the ledger keep it longer, as Arkiv's block rounding does:
    await forge(
      ledger,
      {
        [ANN.type]: 'entitlement',
        [ANN.key]: entitlementIndex(`${KEY}2`),
        [ANN.expiresAt]: T0 + 1000,
      },
      entitlement({ key: `${KEY}2`, expiresAt: T0 + 1000 }),
      3600,
    );
    clock.advance(1000);
    await expect(store.patch(`${KEY}2`, { mbUsed: 1 })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      store.patch(`${KEY}2`, { mbUsed: 1 }, { expiresAt: T0 + DAY }),
    ).rejects.toMatchObject({ code: 'not_found' });
    clock.set(T0);
    await expect(store.patch(KEY, {}, { expiresAt: T0 - 1 })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(store.patch(KEY, { expiresAt: T0 + DAY })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  // Property: the min of the two clocks — a ledger clock BEHIND the server cannot keep an entitlement alive.
  it('ledger clock 60 s behind: the entitlement is dead for the store at annotations.expiresAt', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: () => clock.now() - 60_000 });
    const store = new EntitlementStore(ledger, clock.now);
    await store.create(entitlement({ key: KEY, expiresAt: T0 + 10_000 }));
    clock.advance(10_000);
    expect(await store.getByKey(KEY)).toBeNull();
  });

  // Property: a patch cannot rewrite the logical key or the version; annotations are re-derived.
  it('patch with a hostile key / v / kind → key and v kept, annotations follow the payload', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const store = new EntitlementStore(ledger, clock.now);
    await store.create(entitlement({ key: KEY }));
    const out = await store.patch(KEY, { key: 'paid:0xattacker:0x1', v: 2 as 1, kind: 'paid' });
    expect(out.payload.key).toBe(KEY);
    expect(out.payload.v).toBe(1);
    const [row] = await ledger.query({
      annotations: { [ANN.type]: 'entitlement', [ANN.key]: entitlementIndex(KEY) },
    });
    expect(row!.annotations[ANN.kind]).toBe('paid');
  });

  // Property: a patch that would violate the schema (mbUsed > mbTotal) is refused and leaves the row intact.
  it('patch mbUsed > mbTotal → invalid_request; row unchanged', async () => {
    const clock = fakeClock();
    const store = new EntitlementStore(new InMemoryLedger({ now: clock.now }), clock.now);
    await store.create(entitlement({ key: KEY }));
    await expect(store.patch(KEY, { mbUsed: 10_000 })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect((await store.getByKey(KEY))?.payload.mbUsed).toBe(250);
  });
});

describe('attack: rt receipts and nonces', () => {
  // Property: the agent's spend is summed per (kind, entitlement, UTC day): a human top-up or a receipt one
  // millisecond across midnight is never counted, and a duplicate receipt key is refused (no double count).
  it('spentUsd6 isolation and duplicate receipt refusal', async () => {
    const clock = fakeClock();
    const store = new ReceiptStore(new InMemoryLedger({ now: clock.now }), clock.now);
    const H: Hex = `0x${'12'.repeat(32)}`;
    const midnight = Date.UTC(2026, 10, 4);
    await store.add(
      receipt({
        key: 'rcpt:a',
        kind: 'agent-topup',
        entitlementKeyHash: H,
        usd6: '400000',
        at: midnight - 1,
      }),
    );
    await store.add(
      receipt({
        key: 'rcpt:b',
        kind: 'agent-topup',
        entitlementKeyHash: H,
        usd6: '400000',
        at: midnight,
      }),
    );
    await store.add(
      receipt({
        key: 'rcpt:c',
        kind: 'topup',
        entitlementKeyHash: H,
        usd6: '9000000',
        at: midnight,
      }),
    );
    await expect(
      store.add(
        receipt({
          key: 'rcpt:b',
          kind: 'agent-topup',
          entitlementKeyHash: H,
          usd6: '400000',
          at: midnight,
        }),
      ),
    ).rejects.toMatchObject({ code: 'replay' });
    expect(await store.spentUsd6(H, 'agent-topup', Math.floor(midnight / DAY))).toBe(400_000n);
    expect(await store.spentUsd6(H, 'agent-topup', Math.floor(midnight / DAY) - 1)).toBe(400_000n);
  });

  // Property: a malformed live nonce row still counts as consumed (fail closed).
  it('NonceStore.consumed counts a malformed row', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const n: Hex = `0x${'ee'.repeat(32)}`;
    await forge(ledger, { [ANN.type]: 'nonce', [ANN.key]: keys.nonce(n) }, '{', 120);
    expect(await new NonceStore(ledger, clock.now).consumed(n)).toBe(true);
  });
});
