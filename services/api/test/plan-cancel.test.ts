/** POST /plan/cancel: an unused paid plan's payer gets the payment back (minus the reclaim fee), exactly once. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@ethglobal/adapters';
import type { Hex } from '@ethglobal/protocol/ids';
import type { EntitledResponse, MeResponse, PlanCancelResponse } from '@ethglobal/protocol/schemas';

import { addressOf, signCancelPlan } from './support/client.js';
import {
  buyGift,
  DAY,
  errorOf,
  harness,
  hcsMessages,
  HUMAN_KEY,
  iccidOf,
  payerSessionKey,
  provisioned,
  provisionPaid,
  reasonOf,
  reclaimGift,
  redeemPin,
  seedCard,
  STRANGER_KEY,
  topUp,
  type Harness,
} from './support/harness.js';
import { retryPendingOnBoot } from '../src/flows/fulfil.js';
import { recoverRefunds } from '../src/flows/refund-recovery.js';

/** A ready 1 GB plan ($4.00) paid by HUMAN_KEY. */
async function paidPlan(h: Harness): Promise<string> {
  const { res } = await provisionPaid(h);
  expect(res.status).toBe(201);
  return ((await res.json()) as EntitledResponse).entitlementKey;
}

/** CancelPlan signed by `signer` for `payer` (default: the signer's own address) on a payer-bound challenge. */
async function cancel(
  h: Harness,
  key: string,
  signer: Hex = HUMAN_KEY,
  o: { payer?: string; issuedAt?: number } = {},
) {
  const payer = o.payer ?? addressOf(signer);
  const challenge = await h.challengeFor('/plan/cancel', payerSessionKey(payer));
  const issuedAt = o.issuedAt ?? h.clock.now();
  const signature = await signCancelPlan(signer, h.deps.chainId, {
    entitlementKey: key,
    nonce: challenge.nonce as Hex,
    issuedAt,
  });
  const body = { entitlementKey: key, payer, challenge, issuedAt, signature };
  return { res: await h.json('/plan/cancel', body), body };
}

const cancelReceipts = async (h: Harness) =>
  (
    await h.adapters.ledger.query({ annotations: { type: 'receipt', receiptKind: 'plan-cancel' } })
  ).map((r) => JSON.parse(r.payload) as Record<string, unknown>);
const me = async (h: Harness, key: string) => {
  const res = await h.get(`/me/${encodeURIComponent(key)}`);
  return { status: res.status, body: (await res.json()) as MeResponse };
};

describe('POST /plan/cancel', () => {
  it('cannot recreate a cancelled entitlement through its retained delivery intent after ledger expiry', async () => {
    const h = await harness();
    const purchased = await provisionPaid(h);
    const { entitlementKey: key } = (await purchased.res.json()) as EntitledResponse;
    expect((await cancel(h, key)).res.status).toBe(200);
    h.clock.advance(1_001);
    expect(await h.deps.stores.entitlements.getByKey(key)).toBeNull();
    expect(h.deps.pendingDelivery.has(key)).toBe(true);
    const order = vi.spyOn(h.reseller, 'order');
    const response = await h.json(`/me/${encodeURIComponent(key)}/delivery`, {
      sessionPubKey: purchased.spk,
    });
    expect(response.status).toBe(410);
    expect(order).not.toHaveBeenCalled();
    expect(await h.deps.stores.entitlements.getByKey(key)).toBeNull();
    await retryPendingOnBoot(h.deps);
    expect(order).not.toHaveBeenCalled();
    expect(await h.deps.stores.entitlements.getByKey(key)).toBeNull();
  });
  it('serializes cancellation behind an in-flight top-up and refuses the refund after that payment', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = h.reseller.topUp.bind(h.reseller);
    vi.spyOn(h.reseller, 'topUp').mockImplementation(async (...args) => {
      started();
      await wait;
      return original(...args);
    });
    const topping = topUp(h, key);
    await entered;
    const cancelling = cancel(h, key);
    release();
    expect((await topping).paid.status).toBe(200);
    expect(await reasonOf((await cancelling).res)).toEqual([409, 'topped-up']);
    expect(h.treasury.refunds()).toHaveLength(0);
    expect((await h.deps.stores.entitlements.getByKey(key))?.payload.mbTotal).toBe(2000);
  });

  it('retains a confirmed refund transaction when the receipt patch fails and repairs it without another payment', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    vi.spyOn(h.deps.stores.receipts, 'patch').mockRejectedValueOnce(new Error('ledger offline'));
    const { res } = await cancel(h, key);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanCancelResponse;
    expect(body.refund.tx).toBe(h.treasury.refunds()[0]!.tx);
    const refund = vi.spyOn(h.treasury, 'refund');
    await recoverRefunds(h.deps, key);
    expect(refund).not.toHaveBeenCalled();
    expect(await cancelReceipts(h)).toEqual([expect.objectContaining({ tx: body.refund.tx })]);
  });

  it('saves signed refund bytes before broadcast and reconciles after restart even when the original receipt expires', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'audit-refund-')), 'api.state');
    const h = await harness({ env: { STATE_FILE: file } });
    const key = await paidPlan(h);
    const prepared = {
      v: 1 as const,
      kind: 'evm' as const,
      network: 'eip155:31337',
      tx: `0x${'cd'.repeat(32)}`,
      signedTransaction: `0x${'ab'.repeat(128)}`,
    };
    let confirmed = false;
    const prepareRefund = vi.fn(async () => prepared);
    const submitRefund = vi.fn(async () => {
      expect(h.deps.refundJobs.entries()[0]?.[1].prepared).toEqual(prepared);
      throw new Error('receipt timeout after broadcast');
    });
    const refundStatus = vi.fn(async () =>
      confirmed ? ('success' as const) : ('pending' as const),
    );
    Object.assign(h.adapters.treasury, { prepareRefund, submitRefund, refundStatus });
    const { res } = await cancel(h, key);
    expect(res.status).toBe(202);
    expect(((await res.json()) as PlanCancelResponse).refund).toMatchObject({
      recovery: 'automatic',
    });
    expect(readFileSync(file, 'utf8')).not.toContain(prepared.signedTransaction);
    confirmed = true;
    h.clock.advance(39 * DAY);
    const restarted = await h.restart();
    await recoverRefunds(restarted.deps, key);
    expect(prepareRefund).toHaveBeenCalledTimes(1);
    expect(submitRefund).toHaveBeenCalledTimes(1);
    expect(await cancelReceipts(h)).toEqual([expect.objectContaining({ tx: prepared.tx })]);
  });

  it('stops rebroadcasting an expired signed refund but still accepts a late confirmation', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    const prepared = {
      v: 1 as const,
      kind: 'evm' as const,
      network: 'eip155:31337',
      tx: `0x${'de'.repeat(32)}`,
      signedTransaction: '0x1234',
      expiresAt: h.clock.now() + 120_000,
    };
    let confirmed = false;
    const submitRefund = vi.fn(async () => {
      throw new Error('unknown outcome');
    });
    Object.assign(h.adapters.treasury, {
      prepareRefund: async () => prepared,
      submitRefund,
      refundStatus: async () => (confirmed ? 'success' : 'pending'),
    });
    expect((await cancel(h, key)).res.status).toBe(202);
    h.clock.advance(13 * 60_000);
    const review = await me(h, key);
    expect(review.body.refund).toMatchObject({ recovery: 'manual' });
    expect(submitRefund).toHaveBeenCalledTimes(1);
    confirmed = true;
    h.clock.advance(16_000);
    const complete = await me(h, key);
    expect(complete.body.refund).toMatchObject({ tx: prepared.tx });
    expect(complete.body.refund?.recovery).toBeUndefined();
    expect(submitRefund).toHaveBeenCalledTimes(1);
  });

  it('unused paid plan: /me offers the refund; 200 refunds paid − fee once to the payer, the vendor cancels, receipt + HCS carry the tx, /me reports the cancel', async () => {
    const h = await harness({ env: { GIFT_RECLAIM_FEE_USD6: '10000' } });
    const key = await paidPlan(h);
    const payer = addressOf(HUMAN_KEY);
    const offer = (await me(h, key)).body.refundable;
    expect([offer?.usd6, offer?.to]).toEqual(['3990000', payer]);
    const { res } = await cancel(h, key);
    expect(res.status).toBe(200);
    const out = (await res.json()) as PlanCancelResponse;
    expect([out.refund.usd6, out.refund.network]).toEqual(['3990000', offer?.network]);
    expect(out.refund.tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h.treasury.refunds()).toEqual([
      expect.objectContaining({ to: payer, usd6: 3_990_000n, tx: out.refund.tx }),
    ]);
    expect((await h.reseller.usage(iccidOf(h, key))).status).toBe('expired');
    expect(await cancelReceipts(h)).toEqual([
      expect.objectContaining({ usd6: '3990000', tx: out.refund.tx, mb: 1000, payer }),
    ]);
    expect(hcsMessages(h).at(-1)).toMatchObject({
      t: 'plan-cancel',
      tx: out.refund.tx,
      usd6: '3990000',
      feeUsd6: '10000',
    });
    // the entitlement's expiry moved to now: once it has passed, /me answers the cancelled plan from its receipt
    h.clock.advance(1_000);
    const after = await me(h, key);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({
      kind: 'paid',
      mbTotal: 1000,
      remainingMb: 0,
      expiresAt: out.cancelledAt,
      cancelledAt: out.cancelledAt,
      refund: { usd6: '3990000', tx: out.refund.tx },
    });
    expect(after.body.refundable).toBeUndefined();
    // the cancelled plan is never charged for a top-up
    expect((await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=1000`)).status).toBe(410);
  });

  it('the same request replayed ⇒ no second refund; a fresh signature ⇒ 409 already-cancelled (404 once expired); two at once ⇒ one refund', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    const first = await cancel(h, key);
    expect(first.res.status).toBe(200);
    const replayed = await h.json('/plan/cancel', first.body);
    expect([replayed.status, await errorOf(replayed)]).toEqual([409, 'replay']);
    expect(await reasonOf((await cancel(h, key)).res)).toEqual([409, 'already-cancelled']);
    h.clock.advance(1_000);
    expect((await cancel(h, key)).res.status).toBe(404);
    expect(h.treasury.refunds()).toHaveLength(1);

    const other = await paidPlan(h);
    const [a, b] = await Promise.all([cancel(h, other), cancel(h, other)]);
    expect([a.res.status, b.res.status].sort()).toEqual([200, 409]);
    expect(h.treasury.refunds()).toHaveLength(2);
  });

  it('a signer other than the recorded payer ⇒ 401 and nothing happens (no vendor cancel, no receipt, no refund)', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    // the stranger signs for itself: valid signature, not the payer the entitlement recorded
    expect(await reasonOf((await cancel(h, key, STRANGER_KEY)).res)).toEqual([401, 'not-payer']);
    // the stranger claims to be the payer: the signature does not verify
    const forged = await cancel(h, key, STRANGER_KEY, { payer: addressOf(HUMAN_KEY) });
    expect([forged.res.status, await errorOf(forged.res)]).toEqual([401, 'unauthorized']);
    // a signature older than PLAN_CANCEL_TTL_MS ⇒ 410
    const stale = await cancel(h, key, HUMAN_KEY, { issuedAt: h.clock.now() - 11 * 60_000 });
    expect(stale.res.status).toBe(410);
    expect(h.treasury.refunds()).toHaveLength(0);
    expect(await cancelReceipts(h)).toHaveLength(0);
    expect((await h.reseller.usage(iccidOf(h, key))).status).toBe('ready');
  });

  it('an installed eSIM (the vendor reads it in use) ⇒ 409 installed: no vendor cancel, no receipt, no refund', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    h.reseller.advanceUsage(iccidOf(h, key), 1);
    const vendorCancel = vi.spyOn(h.reseller, 'cancel');
    expect(await reasonOf((await cancel(h, key)).res)).toEqual([409, 'installed']);
    expect(vendorCancel).not.toHaveBeenCalled();
    expect(h.treasury.refunds()).toHaveLength(0);
    expect(await cancelReceipts(h)).toHaveLength(0);
  });

  it('a plan with a top-up ⇒ 409 topped-up, and /me offers no refund', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    expect((await topUp(h, key)).paid.status).toBe(200);
    expect(await reasonOf((await cancel(h, key)).res)).toEqual([409, 'topped-up']);
    expect((await me(h, key)).body.refundable).toBeUndefined();
    expect(h.treasury.refunds()).toHaveLength(0);
  });

  it('free (sponsored), gift and card plans ⇒ 409 not-paid', async () => {
    const h = await harness();
    const free = await provisioned(h);
    const card = await redeemPin(h, (await seedCard(h)).pin);
    const gift = await redeemPin(h, (await buyGift(h, 'bob.eth', 1000)).pin, '/gift/claim');
    expect([card.status, gift.status]).toEqual([201, 201]);
    for (const key of [
      free.key,
      ((await card.json()) as EntitledResponse).entitlementKey,
      ((await gift.json()) as EntitledResponse).entitlementKey,
    ])
      expect(await reasonOf((await cancel(h, key)).res)).toEqual([409, 'not-paid']);
    expect(h.treasury.refunds()).toHaveLength(0);
  });

  it('the vendor refuses ⇒ 409 vendor-refused, no refund, the receipt aborted (usd6 0, no tx); the plan stays live and usable', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    vi.spyOn(h.reseller, 'cancel').mockRejectedValueOnce(
      new AdapterError('reseller', 'invalid_response', 'eSIM Access /esim/cancel failed (200002)'),
    );
    expect(await reasonOf((await cancel(h, key)).res)).toEqual([409, 'vendor-refused']);
    expect(h.treasury.refunds()).toHaveLength(0);
    const [aborted] = await cancelReceipts(h);
    expect(aborted).toMatchObject({ usd6: '0' });
    expect(aborted).not.toHaveProperty('tx');
    const live = await me(h, key);
    expect([live.status, live.body.refundable, live.body.cancelledAt]).toEqual([
      200,
      undefined,
      undefined,
    ]);
    expect(await reasonOf((await cancel(h, key)).res)).toEqual([409, 'already-cancelled']);
    expect((await topUp(h, key)).paid.status).toBe(200);
  });

  it('the vendor does not answer ⇒ 503, the receipt stays pending, no refund; no second cancel, no top-up', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    vi.spyOn(h.reseller, 'cancel').mockRejectedValueOnce(
      new AdapterError('reseller', 'unavailable', 'timeout'),
    );
    const { res } = await cancel(h, key);
    expect([res.status, await errorOf(res)]).toEqual([503, 'reseller_unavailable']);
    expect(await cancelReceipts(h)).toEqual([expect.objectContaining({ usd6: '4000000' })]);
    expect(h.treasury.refunds()).toHaveLength(0);
    expect(await reasonOf((await cancel(h, key)).res)).toEqual([409, 'already-cancelled']);
    const quote = await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=1000`);
    expect([quote.status, await errorOf(quote)]).toEqual([410, 'expired']);
  });

  it('the treasury throws ⇒ 202 refund pending: cancelled, receipt pending, the plan ends; a retry never refunds twice', async () => {
    const h = await harness();
    const key = await paidPlan(h);
    h.treasury.failNext = true;
    const { res } = await cancel(h, key);
    expect(res.status).toBe(202);
    const out = (await res.json()) as PlanCancelResponse;
    expect([out.refund.usd6, out.refund.tx]).toEqual(['4000000', undefined]);
    const [pending] = await cancelReceipts(h);
    expect(pending).toMatchObject({ usd6: '4000000' });
    expect(pending).not.toHaveProperty('tx');
    expect(await reasonOf((await cancel(h, key)).res)).toEqual([409, 'already-cancelled']);
    h.clock.advance(1_000);
    expect((await cancel(h, key)).res.status).toBe(404);
    expect(h.treasury.refunds()).toHaveLength(0);
    const after = await me(h, key);
    expect(after.body).toMatchObject({ cancelledAt: out.cancelledAt, refund: { usd6: '4000000' } });
    expect(after.body.refund?.tx).toBeUndefined();
  });

  it('TREASURY_MAX_USD6_PER_DAY counts gift reclaims and plan cancels together: over it ⇒ 503 treasury_cap, nothing cancelled', async () => {
    const h = await harness({ env: { TREASURY_MAX_USD6_PER_DAY: '4200000' } });
    const gift = await buyGift(h, 'bob.eth', 1000); // $4.00
    h.clock.advance(7 * DAY + 1);
    expect((await reclaimGift(h, gift.giftId)).status).toBe(200);
    const key = await paidPlan(h); // + $0.40 > $4.20
    const { res } = await cancel(h, key);
    expect([...(await reasonOf(res)), await errorOf(res)]).toEqual([
      503,
      'treasury_cap',
      'chain_unavailable',
    ]);
    expect(h.treasury.refunds()).toHaveLength(1);
    expect(await cancelReceipts(h)).toHaveLength(0);
    expect((await h.reseller.usage(iccidOf(h, key))).status).toBe('ready');
  });
});
