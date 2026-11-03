/** describeReseller: the eSIM reseller port contract (L7, L8; T-34, T-39, T-40). */
import { LPA_PATTERN } from '@ethglobal/protocol/schemas';
import { describe, expect, it } from 'vitest';

import type { Reseller } from '../../types.js';

export interface ResellerSubject {
  reseller: Reseller;
  /** The subject's clock (ms). */
  now: () => number;
  /** A fresh, valid webhook delivery about `iccid` as the provider sends it (body + the headers the route sets). */
  deliver(iccid: string, now: number): { body: string; headers: Record<string, string> };
  /** Signed providers reject a skewed timestamp; unsigned ones (eSIM Access, A-27) carry none. */
  timestamped: boolean;
  /** Signed providers detect a tampered body; unsigned ones only dedupe by body hash (the body is a hint). */
  bodyBound: boolean;
}

export function describeReseller(name: string, make: () => Promise<ResellerSubject>): void {
  describe(`Reseller contract: ${name}`, () => {
    async function ordered() {
      const subject = await make();
      const [plan] = await subject.reseller.plans('IN');
      const profile = await subject.reseller.order(plan!.id, { idempotencyKey: 'suite-order-1' });
      return { ...subject, plan: plan!, profile };
    }

    it('plans: integer MB and days, bigint wholesale price, India only', async () => {
      const { reseller } = await make();
      const plans = await reseller.plans('IN');
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) {
        expect(p.country).toBe('IN');
        expect(p.provider).toBe(reseller.name);
        expect(Number.isSafeInteger(p.dataMb) && p.dataMb > 0).toBe(true);
        expect(Number.isSafeInteger(p.validityDays) && p.validityDays > 0).toBe(true);
        expect(typeof p.wholesaleUsd6).toBe('bigint');
        expect(p.wholesaleUsd6 > 0n).toBe(true);
        expect(p.name.length).toBeLessThanOrEqual(64);
      }
    });

    it('order is idempotent per key, also when concurrent (T-40); the LPA matches LPA_PATTERN (T-39)', async () => {
      const { reseller, plan, profile } = await ordered();
      expect(profile.lpa).toMatch(LPA_PATTERN);
      expect(profile.iccid).toMatch(/^\d{18,22}$/);
      expect(profile.planId).toBe(plan.id);
      const again = await reseller.order(plan.id, { idempotencyKey: 'suite-order-1' });
      expect(again).toEqual(profile);
      const [x, y] = await Promise.all([
        reseller.order(plan.id, { idempotencyKey: 'suite-order-2' }),
        reseller.order(plan.id, { idempotencyKey: 'suite-order-2' }),
      ]);
      expect(x).toEqual(y);
    });

    it('usage is monotonic across two reads and within [0, totalMb]', async () => {
      const { reseller, profile, now } = await ordered();
      const a = await reseller.usage(profile.iccid);
      const b = await reseller.usage(profile.iccid);
      for (const u of [a, b]) {
        expect(u.iccid).toBe(profile.iccid);
        expect(u.usedMb).toBeGreaterThanOrEqual(0);
        expect(u.usedMb).toBeLessThanOrEqual(u.totalMb);
        expect(u.asOf).toBe(now());
      }
      expect(b.usedMb).toBeGreaterThanOrEqual(a.usedMb);
    });

    it('topUp twice with one key is one top-up', async () => {
      const { reseller, profile } = await ordered();
      const first = await reseller.topUp(profile.iccid, 1000, { idempotencyKey: 'suite-topup-1' });
      const second = await reseller.topUp(profile.iccid, 1000, { idempotencyKey: 'suite-topup-1' });
      expect(second).toEqual(first);
    });

    it('verifyWebhook accepts a fresh delivery once, then reports replay; never throws (T-34)', async () => {
      const { reseller, profile, deliver, now } = await ordered();
      const { body, headers } = deliver(profile.iccid, now());
      const verdict = reseller.verifyWebhook(body, headers, now());
      expect(verdict).toMatchObject({ ok: true });
      expect(reseller.verifyWebhook(body, headers, now())).toEqual({ ok: false, reason: 'replay' });
      expect(() => reseller.verifyWebhook('{', {}, now())).not.toThrow();
      expect(reseller.verifyWebhook(body, {}, now())).toMatchObject({ ok: false });
    });

    it('a skewed timestamp is rejected (signed providers)', async (ctx) => {
      const { reseller, profile, deliver, now, timestamped } = await ordered();
      if (!timestamped) return ctx.skip();
      const late = deliver(profile.iccid, now() - 301_000);
      expect(reseller.verifyWebhook(late.body, late.headers, now())).toEqual({ ok: false, reason: 'skew' });
    });

    it('a tampered body is rejected (signed providers)', async (ctx) => {
      const { reseller, profile, deliver, now, bodyBound } = await ordered();
      if (!bodyBound) return ctx.skip();
      const { body, headers } = deliver(profile.iccid, now());
      expect(reseller.verifyWebhook(body.replace(/\d(?=\D*$)/, '9'), headers, now())).toEqual({
        ok: false,
        reason: 'bad_signature',
      });
    });

    it('parseWebhook yields usage events for the ICCID (or hints only), rejects garbage', async () => {
      const { reseller, profile, deliver, now } = await ordered();
      const events = reseller.parseWebhook(deliver(profile.iccid, now()).body);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.iccid).toBe(profile.iccid);
        expect(e.provider).toBe(reseller.name);
        expect(e.usedMb).toBeLessThanOrEqual(e.totalMb);
      }
      expect(() => reseller.parseWebhook('not json')).toThrow(expect.objectContaining({ code: 'invalid_response' }));
    });
  });
}
