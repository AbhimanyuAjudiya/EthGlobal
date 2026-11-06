import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AdapterError, MockReseller } from '@ethglobal/adapters';
import { openLpa, lpaAad, sha256Hex, type SealedBox } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type { DeliveryResponse, EntitledResponse } from '@ethglobal/protocol/schemas';

import { retryPendingOnBoot } from '../../src/flows/fulfil.js';
import { flushReceiptOutbox, record } from '../../src/flows/record.js';
import { recoverFreeReservations } from '../../src/middleware/octroi.js';
import { patchUsage } from '../../src/routes/webhooks.js';
import { agentPolicyPut } from '../support/client.js';
import {
  DAY,
  harness,
  HUMAN_KEY,
  provisioned,
  provisionPaid,
  redeemPin,
  seedCard,
  topUp,
} from '../support/harness.js';

describe('audit: durable operations and delivery', () => {
  it('recovers a settled top-up after a process restart using the same expired authorization', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'audit-paid-')), 'api.state');
    const h = await harness({ env: { STATE_FILE: file } });
    const { key } = await provisioned(h);
    vi.spyOn(h.reseller, 'topUp').mockRejectedValueOnce(
      new AdapterError('reseller', 'unavailable', 'offline'),
    );
    const first = await topUp(h, key);
    expect(first.paid.status).toBe(503);
    expect(readFileSync(file, 'utf8')).not.toContain(key);
    h.clock.advance(6 * 60_000);
    const restarted = await h.restart();
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const response = await restarted.app.request(first.path, {
      headers: { ...first.pay, 'x-forwarded-for': '192.0.2.5' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mbTotal: 1300 });
    expect(settle).not.toHaveBeenCalled();
  });

  it('recovers the original session after entitlement creation fails before any provider order', async () => {
    const h = await harness({
      env: { STATE_FILE: join(mkdtempSync(join(tmpdir(), 'audit-create-')), 'api.state') },
    });
    vi.spyOn(h.deps.stores.entitlements, 'create').mockRejectedValueOnce(
      new Error('ledger offline'),
    );
    const paid = await provisionPaid(h);
    expect(paid.res.status).toBe(500);
    const [key] = h.deps.pendingDelivery.entries()[0]!;
    expect(h.reseller.orders()).toHaveLength(0);
    const restarted = await h.restart();
    expect(await retryPendingOnBoot(restarted.deps)).toEqual({ retried: 1, ready: 1 });
    const response = await restarted.app.request(`/me/${encodeURIComponent(key)}/delivery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.5' },
      body: JSON.stringify({ sessionPubKey: paid.spk }),
    });
    expect(response.status).toBe(200);
    expect(h.reseller.orders()).toHaveLength(1);
  });

  it('reacquires rolled-back free reservations without spending another proof', async () => {
    const h = await harness();
    const put = h.adapters.ledger.put.bind(h.adapters.ledger);
    let freeLocks = 0;
    vi.spyOn(h.adapters.ledger, 'put').mockImplementation(async (input) => {
      if (
        input.annotations?.type === 'claim' &&
        (JSON.parse(input.payload) as { scope?: string }).scope === 'free-live' &&
        ++freeLocks === 2
      )
        throw new Error('second reservation unavailable');
      return put(input);
    });
    const first = await h.claim({ seed: 'reservation-recovery' });
    expect(first.res.status).toBe(503);
    const intent = h.deps.intents.get(first.spk)!;
    expect(intent.reserved).toBe(false);
    h.clock.advance(61_000);
    await recoverFreeReservations(h.deps);
    for (const lock of intent.reservation!.locks)
      expect(await h.deps.stores.claims.held(lock.key)).toBe(false);
    const retry = await h.claim({ seed: 'reservation-recovery', keys: first.keys });
    expect(retry.res.status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('recovers a mined free claim after its transaction checkpoint fails even when its budget is exhausted', async () => {
    const h = await harness({ campaign: { budget: 500_000n } });
    const persist = h.deps.intents.set.bind(h.deps.intents);
    let fail = true;
    vi.spyOn(h.deps.intents, 'set').mockImplementation((key, value, expiry) => {
      if (value.claimTx && fail) {
        fail = false;
        throw new Error('checkpoint unavailable');
      }
      return persist(key, value, expiry);
    });
    const first = await h.claim({ seed: 'mined-before-checkpoint' });
    expect(first.res.status).toBe(500);
    const retry = await h.claim({ seed: 'mined-before-checkpoint', keys: first.keys });
    expect(retry.res.status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    expect(await retry.res.json()).toMatchObject({ claimTx: h.dataDrop.claimedEvents[0]!.tx });
  });

  it('resumes a settled top-up after vendor failure and authorization expiry, then replays without adding twice', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const vendor = vi
      .spyOn(h.reseller, 'topUp')
      .mockRejectedValueOnce(new AdapterError('reseller', 'unavailable', 'offline'));
    const first = await topUp(h, key);
    expect(first.paid.status).toBe(503);
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    h.clock.advance(6 * 60_000);
    expect((await h.get(first.path, first.pay)).status).toBe(200);
    expect((await h.get(first.path, first.pay)).status).toBe(200);
    expect(settle).not.toHaveBeenCalled();
    expect(vendor).toHaveBeenCalledTimes(2);
    expect((await h.deps.stores.entitlements.getByKey(key))?.payload.mbTotal).toBe(1300);
  });

  it('persists the delivery target before ordering and recovers ciphertext only for the original session', async () => {
    const h = await harness({
      overrides: { adapters: { reseller: new MockReseller({ failNextOrder: true }) } },
    });
    const originalOrder = h.reseller.order.bind(h.reseller);
    vi.spyOn(h.reseller, 'order').mockImplementation(async (plan, options) => {
      expect(h.deps.pendingDelivery.has(options.idempotencyKey)).toBe(true);
      return originalOrder(plan, options);
    });
    const purchased = await provisionPaid(h);
    expect(purchased.res.status).toBe(202);
    const body = (await purchased.res.json()) as EntitledResponse;
    await retryPendingOnBoot(h.deps);
    const path = `/me/${encodeURIComponent(body.entitlementKey)}/delivery`;
    expect((await h.json(path, { sessionPubKey: `0x${'ab'.repeat(32)}` })).status).toBe(401);
    const res = await h.json(path, { sessionPubKey: purchased.spk });
    expect(res.status).toBe(200);
    const delivery = (await res.json()) as DeliveryResponse;
    expect(delivery.status).toBe('ready');
    if (delivery.status !== 'ready') throw new Error('not ready');
    expect(
      openLpa(
        delivery.sealedLpa as SealedBox,
        purchased.keys.secretKey,
        lpaAad(delivery.nonce as Hex, body.entitlementKey),
      ),
    ).toMatch(/^LPA:/);
    expect((await h.json(path, { sessionPubKey: purchased.spk })).status).toBe(200);
  });

  it('does not burn a card when its campaign is temporarily paused', async () => {
    const h = await harness();
    const card = await seedCard(h);
    await h.dataDrop.pause(h.campaignId, true);
    expect((await redeemPin(h, card.pin)).status).toBe(423);
    await h.dataDrop.pause(h.campaignId, false);
    expect((await redeemPin(h, card.pin)).status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('keeps failed accounting receipts durably queued and repairs them before applying the daily cap', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '1' } });
    const { key } = await provisioned(h);
    const put = h.adapters.ledger.put.bind(h.adapters.ledger);
    let fail = true;
    vi.spyOn(h.adapters.ledger, 'put').mockImplementation(async (input) => {
      if (fail && input.annotations?.type === 'receipt') {
        fail = false;
        throw new Error('receipt transport failed');
      }
      return put(input);
    });
    expect((await topUp(h, key)).paid.status).toBe(200);
    expect(h.deps.receiptOutbox.size).toBe(1);
    h.clock.advance(61_000);
    expect((await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=1000`)).status).toBe(429);
    expect(h.deps.receiptOutbox.size).toBe(0);
  });

  it('counts a settled top-up against the daily cap even if receipt lookup fails before the outbox write', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '1' } });
    const { key } = await provisioned(h);
    const chargedAt = h.clock.now();
    vi.spyOn(h.deps.stores.receipts, 'byKey').mockRejectedValueOnce(
      new Error('receipt read failed'),
    );
    const first = await topUp(h, key);
    expect(first.paid.status).toBe(500);
    expect(h.deps.receiptOutbox.size).toBe(0);
    expect((await h.get(first.path)).status).toBe(429);
    h.clock.advance(DAY);
    expect((await h.get(first.path, first.pay)).status).toBe(200);
    const receipts = await h.deps.stores.receipts.forEntitlement(sha256Hex(key));
    expect(receipts.find((receipt) => receipt.kind === 'topup')?.at).toBe(chargedAt);
    expect((await h.deps.stores.entitlements.getByKey(key))?.payload.mbTotal).toBe(1300);
  });

  it('keeps the original accounting day when a receipt is repaired on a later day', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const at = h.clock.now();
    vi.spyOn(h.deps.stores.receipts, 'add').mockRejectedValueOnce(new Error('ledger offline'));
    await record(
      h.deps,
      key,
      { key: 'rcpt:ledger:delayed-audit', kind: 'topup', mb: 1000, usd6: '4000000' },
      {
        t: 'settle',
        kind: 'topup',
        network: 'eip155:31337',
        tx: `0x${'ef'.repeat(32)}`,
        payer: '0x0000000000000000000000000000000000000001',
        usd6: '4000000',
        mb: 1000,
      },
    );
    h.clock.advance(DAY);
    await flushReceiptOutbox(h.deps);
    expect((await h.deps.stores.receipts.byKey('rcpt:ledger:delayed-audit'))?.at).toBe(at);
  });

  it('rejects an oversized physical package allocation before payment or claiming its card', async () => {
    const h = await harness({ env: { RESELLER_PLAN_ID: 'in-300mb-7d' } });
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    expect(
      (await h.get('/esim/provision?mb=1000', { 'x-session-pubkey': `0x${'ab'.repeat(32)}` }))
        .status,
    ).toBe(400);
    expect(settle).not.toHaveBeenCalled();
    const card = await seedCard(h, 1000);
    expect((await redeemPin(h, card.pin)).status).toBe(400);
    expect((await h.deps.stores.gifts.bySerial(card.serial))?.payload.state).toBe('open');
    expect(h.dataDrop.claimedEvents).toHaveLength(0);
  });
});

describe('audit: policy, usage and observability', () => {
  it('an old approval cannot arm new limits even if revocation does not checkpoint', async () => {
    const h = await harness({ env: { WORLD_AGENT_PASS_CLIENT_ID: 'simulated' } });
    const purchased = await provisionPaid(h);
    const { entitlementKey: key } = (await purchased.res.json()) as EntitledResponse;
    const policy = {
      maxUsd6PerDay: '4000000',
      thresholdMb: 50,
      stepMb: 1000,
      paused: false,
      topUpOnExpiry: false,
      expiryLeadS: 60,
    };
    await h.json(
      '/agent/policy',
      await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, policy, h.clock.now()),
      {},
      'PUT',
    );
    h.deps.agentPass!.sim!.script = { outcome: 'approve' };
    const passPath = `/agent/policy/${encodeURIComponent(key)}/pass`;
    await h.json(`${passPath}/start`, {});
    expect((await h.json(`${passPath}/poll`, {})).status).toBe(200);
    expect(h.deps.agentPass!.armed(key)).toBe(true);
    vi.spyOn(h.deps.agentPass!, 'revoke').mockImplementation(() => undefined);
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(
            HUMAN_KEY,
            h.deps.chainId,
            key,
            { ...policy, maxUsd6PerDay: '8000000' },
            h.clock.now() + 1,
          ),
          {},
          'PUT',
        )
      ).status,
    ).toBe(200);
    const quote = await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=1000`, {
      'x-agent-uaid': 'uaid:aid:human-forged',
    });
    expect(await quote.json()).toMatchObject({ error: 'pass_required' });
  });

  it('revokes a pending approval when the spending policy changes', async () => {
    const h = await harness({ env: { WORLD_AGENT_PASS_CLIENT_ID: 'simulated' } });
    const paid = await provisionPaid(h);
    const { entitlementKey: key } = (await paid.res.json()) as EntitledResponse;
    const policy = {
      maxUsd6PerDay: '4000000',
      thresholdMb: 50,
      stepMb: 1000,
      paused: false,
      topUpOnExpiry: false,
      expiryLeadS: 60,
    };
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, policy, h.clock.now()),
          {},
          'PUT',
        )
      ).status,
    ).toBe(200);
    h.deps.agentPass!.sim!.script = { outcome: 'approve' };
    const passPath = `/agent/policy/${encodeURIComponent(key)}/pass`;
    expect((await h.json(`${passPath}/start`, {})).status).toBe(200);
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(
            HUMAN_KEY,
            h.deps.chainId,
            key,
            { ...policy, maxUsd6PerDay: '8000000' },
            h.clock.now() + 1,
          ),
          {},
          'PUT',
        )
      ).status,
    ).toBe(200);
    expect((await h.json(`${passPath}/poll`, {})).status).toBe(404);
    expect(h.deps.agentPass!.armed(key)).toBe(false);
  });

  it('uses current total and usage during a stale usage patch', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    await topUp(h, key);
    await patchUsage(
      h.deps,
      key,
      0,
      300,
      { usedMb: 450, asOf: h.clock.now(), status: 'active' },
      'poll',
    );
    await patchUsage(
      h.deps,
      key,
      0,
      300,
      { usedMb: 120, asOf: h.clock.now(), status: 'installed' },
      'webhook',
    );
    expect((await h.deps.stores.entitlements.getByKey(key))?.payload).toMatchObject({
      mbUsed: 450,
      mbTotal: 1300,
      status: 'active',
    });
  });

  it('can pause a second burst after the sponsor unpauses', async () => {
    const h = await harness();
    for (let i = 0; i < 8; i++) await h.deps.anomaly.record(h.campaignId, 10);
    await h.dataDrop.pause(h.campaignId, false);
    for (let i = 0; i < 8; i++) await h.deps.anomaly.record(h.campaignId, 10);
    expect(h.dataDrop.pauses.map((p) => p.paused)).toEqual([true, false, true]);
  });

  it('redacts capability route parameters from request logs', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    await h.get(`/me/${encodeURIComponent(key)}`);
    await h.get(`/agent/policy/${encodeURIComponent(key)}`);
    expect(h.lines.join('')).not.toContain(key);
    expect(h.lines.join('')).not.toContain(encodeURIComponent(key));
    expect(h.lines.join('')).toContain('/me/[redacted]');
  });
});
