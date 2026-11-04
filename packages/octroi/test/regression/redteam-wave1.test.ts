/**
 * Regressions for the octroi red-team wave 1 (RT-O-01…09) and the coordinator's follow-ups (T-15 front-run,
 * T-71e, T-73 b, ReceiptStore patch / by-day). The attack tests themselves live in test/redteam (now passing,
 * named `… [RT-O-0N]`); this file pins the edges of the fixes: lock and marker failures, CAS exhaustion, the
 * index-not-a-capability rule, and the new store methods.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryLedger, type Ledger, type PaymentRail } from '@ethglobal/adapters';
import { fakeClock, paymentPayload, T0 } from '@ethglobal/adapters/testing';
import { NETWORKS, RECEIPT_TTL_S, type Hex } from '@ethglobal/protocol/ids';
import type { PaymentPayload } from '@ethglobal/protocol/schemas';

import {
  buildAccepts,
  consumeChallenge,
  decide,
  entitlementIndex,
  holderHash,
  type Decision,
} from '../../src/index.js';
import {
  AgentPolicyStore,
  CampaignStore,
  ClaimStore,
  EntitlementStore,
  GiftStore,
  ReceiptStore,
} from '../../src/store/index.js';
import {
  campaign,
  claimChallenge,
  deps,
  entitlement,
  failing,
  freeReq,
  gift,
  GIFT_ID,
  ledgerWith,
  permissive,
  receipt,
  resource,
  SECRET,
  SPK,
  type TestDeps,
} from '../helpers.js';
import { networked } from '../redteam/rt-helpers.js';

const DAY = 86_400_000;
const KEY = `ent:v1:0x${'e1'.repeat(32)}`;
const asFree = (d: Decision) => d as Extract<Decision, { kind: 'serve-free' }>;

/** A ledger whose writes of one entity type fail (an Arkiv RPC outage mid-flow). */
const failingPutsOf = (base: Ledger, type: string): Ledger =>
  ledgerWith(base, {
    put: (input) => (input.annotations?.type === type ? failing() : base.put(input)),
  });

/** A ledger on which every compare-and-swap loses (a writer that always wins the race). */
const alwaysConflicting = (base: Ledger): Ledger =>
  ledgerWith(base, {
    update: async () => {
      throw Object.assign(new Error('lost'), { code: 'conflict' });
    },
  });

describe('RT-O-03 / RT-O-08: claim locks (A-33)', () => {
  it('a claim-lock write failure fails closed (ledger-unavailable), before serve-free', async () => {
    const d = deps({ personhood: permissive() });
    const broken: TestDeps = { ...d, ledger: failingPutsOf(d.ledger, 'claim') };
    expect(await decide(freeReq(broken), broken)).toEqual({
      kind: 'deny',
      reason: 'ledger-unavailable',
      detail: 'claim_lock',
    });
  });

  it('the campaign record is itself create-if-absent: a record taken between check and write ⇒ replay', async () => {
    const clock = fakeClock();
    const d = deps({ personhood: permissive() }, clock);
    const c = campaign({ validityDays: 1, expiresAt: T0 + 30 * DAY });
    expect((await decide(freeReq(d, { campaign: c }), d)).kind).toBe('serve-free');
    clock.advance(2 * DAY); // the live lock is gone, the campaign record is not
    // hide claim rows from the reads, so only the create-if-absent write can notice the record
    const blind: TestDeps = {
      ...d,
      ledger: ledgerWith(d.ledger, {
        query: async (q) => (q?.annotations?.type === 'claim' ? [] : d.ledger.query(q)),
      }),
    };
    expect(await decide(freeReq(blind, { campaign: c }), blind)).toEqual({
      kind: 'deny',
      reason: 'replay',
      detail: 'claim_lock',
    });
  });

  it('same human, same campaign, concurrently: one serve-free, one replay (claim_lock or the read)', async () => {
    const d = { ...deps(), personhood: permissive() };
    const ledger = networked(d.ledger);
    const nd: TestDeps = { ...d, ledger };
    const rs = await Promise.all([decide(freeReq(nd), nd), decide(freeReq(nd), nd)]);
    expect(rs.filter((r) => r.kind === 'serve-free')).toHaveLength(1);
    expect(rs.find((r) => r.kind === 'deny')).toMatchObject({ reason: 'replay' });
  });

  it('ClaimStore: reserve once, held after, rethrows a ledger failure', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const claims = new ClaimStore(ledger, () => T0);
    const key = `claim:0x${'01'.repeat(32)}`;
    expect(await claims.held(key)).toBe(false);
    expect(await claims.reserve(key, 'settlement', T0 + DAY)).toBe(true);
    expect(await claims.reserve(key, 'settlement', T0 + DAY)).toBe(false);
    expect(await claims.held(key)).toBe(true);
    const broken = new ClaimStore(failingPutsOf(ledger, 'claim'), () => T0);
    await expect(
      broken.reserve(`claim:0x${'02'.repeat(32)}`, 'settlement', T0 + DAY),
    ).rejects.toThrow('arkiv rpc down');
  });
});

describe('RT-O-05 / T-15: one serve per on-chain payment', () => {
  const offer = (d: TestDeps) => buildAccepts(d, 100).find((r) => r.network === NETWORKS.anvil)!;

  /** A facilitator on which the victim's authorization was front-run: verify sees a used nonce, settle recovers. */
  const frontRun = (tx: Hex): PaymentRail => ({
    createPaymentRequirement: () => {
      throw new Error('unused');
    },
    verify: async () => ({ isValid: false, invalidReason: 'nonce_already_used' }),
    settle: async (p: PaymentPayload) => ({
      success: true,
      transaction: tx,
      network: NETWORKS.anvil,
      payer: (p.payload as { authorization: { from: string } }).authorization.from,
    }),
  });

  it('T-15: a front-run payment is served exactly once (verify nonce_already_used ⇒ settle recovery)', async () => {
    const d: TestDeps = { ...deps(), payments: frontRun(`0x${'f1'.repeat(32)}`) };
    const payment = paymentPayload(offer(d));
    expect((await decide({ resource, mb: 100, payment }, d)).kind).toBe('serve-paid');
    expect(await decide({ resource, mb: 100, payment }, d)).toEqual({
      kind: 'deny',
      reason: 'invalid-payment',
      detail: 'nonce_already_used',
    });
  });

  it('a settlement-marker write failure fails closed (ledger-unavailable), never a serve', async () => {
    const d = deps();
    const broken: TestDeps = { ...d, ledger: failingPutsOf(d.ledger, 'claim') };
    expect(await decide({ resource, mb: 100, payment: paymentPayload(offer(d)) }, broken)).toEqual({
      kind: 'deny',
      reason: 'ledger-unavailable',
      detail: 'settlement',
    });
  });

  it('the settlement marker lives as long as the receipts (RECEIPT_TTL_S)', async () => {
    const d = deps();
    await decide({ resource, mb: 100, payment: paymentPayload(offer(d)) }, d);
    const [marker] = await d.ledger.query({ annotations: { type: 'claim' } });
    expect(marker!.expiresAt).toBe(T0 + RECEIPT_TTL_S * 1000);
  });
});

describe('RT-O-01: the index is not a capability (A-34)', () => {
  it('an entitlement read back by its index from a public dump opens nothing', async () => {
    const d = deps({ personhood: permissive() });
    const r = asFree(await decide(freeReq(d), d));
    const store = new EntitlementStore(d.ledger, d.now);
    await store.create(r.entitlement);
    const [row] = await d.ledger.query({ annotations: { type: 'entitlement' } });
    const onLedger = JSON.parse(row!.payload) as { key: string };
    expect(onLedger.key).toBe(entitlementIndex(r.entitlement.key));
    expect(await store.getByKey(onLedger.key)).toBeNull();
    expect(await store.getByKey(r.entitlement.key)).toMatchObject({
      payload: { key: r.entitlement.key, holderHash: holderHash(r.entitlement.key, SPK) },
    });
    expect(entitlementIndex(onLedger.key)).toBe(onLedger.key); // idempotent
  });
});

describe('RT-O-06: compare-and-swap edges (A-32)', () => {
  it('concurrent upserts of one key (both create first): both land, one row', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    const store = new CampaignStore(networked(base), clock.now);
    await Promise.all([store.put(campaign({ name: 'one' })), store.put(campaign({ name: 'two' }))]);
    expect(await base.query({ annotations: { type: 'campaign' } })).toHaveLength(1);
  });

  it('a CAS that keeps losing gives up after CAS_ATTEMPTS with the conflict (patch, markClaimed, upsert)', async () => {
    const clock = fakeClock();
    const base = new InMemoryLedger({ now: clock.now });
    await new EntitlementStore(base, clock.now).create(entitlement({ key: KEY }));
    await new GiftStore(base, clock.now).create(gift());
    await new CampaignStore(base, clock.now).put(campaign());
    const lossy = alwaysConflicting(base);
    await expect(
      new EntitlementStore(lossy, clock.now).patch(KEY, { mbUsed: 260 }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      new GiftStore(lossy, clock.now).markClaimed(GIFT_ID, 'giftent:x'),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(new CampaignStore(lossy, clock.now).put(campaign())).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('upsert surfaces a non-conflict ledger failure at once', async () => {
    const clock = fakeClock();
    const store = new AgentPolicyStore(
      ledgerWith(new InMemoryLedger({ now: clock.now }), { query: failing }),
      clock.now,
    );
    await expect(
      store.put({
        v: 1,
        entitlementKey: KEY,
        owner: `0x${'66'.repeat(20)}`,
        policy: {
          maxUsd6PerDay: '1000000',
          thresholdMb: 100,
          stepMb: 100,
          paused: false,
          topUpOnExpiry: false,
          expiryLeadS: 3600,
        },
        updatedAt: T0,
      }),
    ).rejects.toThrow('arkiv rpc down');
  });
});

describe('RT-O-07: consumeChallenge with a malformed clock', () => {
  it.each([Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY])('now = %s → invalid', async (now) => {
    const d = deps();
    const c = claimChallenge(d);
    expect(await consumeChallenge(d.ledger, new Set(), c, SPK, now, SECRET)).toBe('invalid');
  });
});

describe('RT-O-07: decide() refuses hostile request shapes with a deny', () => {
  it.each([null, 7, 'x'])('request %j → invalid-request', async (req) => {
    expect(await decide(req as never, deps())).toEqual({
      kind: 'deny',
      reason: 'invalid-request',
      detail: 'request',
    });
  });

  it.each([
    ['fractional claimsThisHour', { claimsThisHour: 0.5 }],
    ['negative spend', { spentUsd6: -1n }],
    ['numeric budget', { budgetUsd6: 5 }],
    ['string paused', { paused: 'no' }],
    ['NaN hour bucket', { hourBucket: Number.NaN }],
  ])('counters with %s → invalid-request before anything is burned', async (_n, over) => {
    const d = deps();
    const req = freeReq(d);
    expect(
      await decide({ ...req, counters: { ...req.counters!, ...(over as object) } }, d),
    ).toEqual({ kind: 'deny', reason: 'invalid-request', detail: 'counters' });
    expect(await d.ledger.query({})).toEqual([]); // the nonce was not consumed
  });

  it('a campaign that is not a valid stored campaign (validityDays 0) → invalid-request', async () => {
    const d = deps();
    expect(await decide(freeReq(d, { campaign: campaign({ validityDays: 0 }) }), d)).toEqual({
      kind: 'deny',
      reason: 'invalid-request',
      detail: 'campaign',
    });
  });

  it('a non-object proof → invalid-request', async () => {
    expect(await decide({ resource, mb: 0, proof: 'proof' as never }, deps())).toEqual({
      kind: 'deny',
      reason: 'invalid-request',
      detail: 'proof',
    });
  });
});

describe('A-32: a hand-built entity without a version reads as revision 1', () => {
  it('an adapter that omits `version` still gets CAS on revision 1', async () => {
    const base = new InMemoryLedger({ now: () => T0 });
    const store = new EntitlementStore(base, () => T0);
    await store.create(entitlement({ key: KEY }));
    const unversioned = ledgerWith(base, {
      query: async (q) => (await base.query(q)).map(({ version: _v, ...e }) => e),
    });
    expect((await new EntitlementStore(unversioned, () => T0).getByKey(KEY))?.version).toBe(1);
  });
});

describe('A-38: ReceiptStore.patch and the by-kind-and-day reads (treasury daily cap)', () => {
  it('byKindAndDay / spentUsd6ForDay sum one kind on one UTC day across entitlements', async () => {
    const store = new ReceiptStore(new InMemoryLedger({ now: () => T0 }), () => T0);
    const day = Math.floor(T0 / DAY);
    await store.add(receipt({ key: 'rcpt:1', kind: 'gift-reclaim', usd6: '1000000' }));
    await store.add(
      receipt({
        key: 'rcpt:2',
        kind: 'gift-reclaim',
        usd6: '2500000',
        entitlementKeyHash: `0x${'22'.repeat(32)}`,
      }),
    );
    await store.add(receipt({ key: 'rcpt:3', kind: 'gift', usd6: '9000000' }));
    await store.add(
      receipt({ key: 'rcpt:4', kind: 'gift-reclaim', usd6: '7000000', at: T0 + DAY }),
    );
    expect((await store.byKindAndDay('gift-reclaim', day)).map((r) => r.key).sort()).toEqual([
      'rcpt:1',
      'rcpt:2',
    ]);
    expect(await store.spentUsd6ForDay('gift-reclaim', day)).toBe(3_500_000n);
    expect(await store.spentUsd6ForDay('gift-reclaim', day + 1)).toBe(7_000_000n);
  });

  it('patch merges under CAS, keeps v and key, refuses a missing receipt', async () => {
    const clock = fakeClock();
    const ledger = networked(new InMemoryLedger({ now: clock.now }));
    const store = new ReceiptStore(ledger, clock.now);
    await store.add(receipt({ key: 'rcpt:pending', kind: 'gift-reclaim', tx: 'pending' }));
    const [a, b] = await Promise.all([
      store.patch('rcpt:pending', { tx: '0xdone' }),
      store.patch('rcpt:pending', { mb: 300 }),
    ]);
    expect([a.tx, b.tx]).toContain('0xdone');
    const [after] = await store.forEntitlement(receipt().entitlementKeyHash as Hex);
    expect(after).toMatchObject({ key: 'rcpt:pending', v: 1, tx: '0xdone', mb: 300 });
    expect(await store.patch('rcpt:pending', { key: 'rcpt:other' })).toMatchObject({
      key: 'rcpt:pending',
    });
    await expect(store.patch('rcpt:missing', { tx: '0x1' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
