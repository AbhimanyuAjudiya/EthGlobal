/**
 * T-25 / T-24, RT-A-11: what a restart must not lose. The sealed STATE_FILE (pending deliveries, T-24 intents), the
 * ledger-backed treasury day total, and the boot retry of pending profiles.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@ethglobal/adapters';
import { dayBucket, type Hex } from '@ethglobal/protocol/ids';

import { retryPendingOnBoot } from '../../src/flows/fulfil.js';
import { reclaim } from '../../src/flows/reclaim.js';
import { DurableState } from '../../src/state.js';
import { addressOf, signGiftReclaim } from '../support/client.js';
import {
  buyGift,
  DAY,
  harness,
  HUMAN_KEY,
  payerSessionKey,
  reclaimGift,
} from '../support/harness.js';

const stateFile = () => join(mkdtempSync(join(tmpdir(), 't25-state-')), 'api.state');
const SEAL = new Uint8Array(32).fill(5);

describe('DurableState (state.ts)', () => {
  it('round-trips through a sealed file; rows expire; a file it cannot open refuses to load', () => {
    const file = stateFile();
    let now = 1_000;
    const a = new DurableState({ file, sealKey: SEAL, now: () => now });
    expect(a.durable).toBe(true);
    const m = a.map<{ k: string }>('ns');
    m.set('ent:v1:capability', { k: 'v' });
    m.set('short', { k: 'gone' }, 2_000);
    expect(m.size).toBe(2);
    expect(readFileSync(file, 'utf8')).not.toContain('ent:v1:capability'); // sealed, not plain JSON
    const b = new DurableState({ file, sealKey: SEAL, now: () => now }).map<{ k: string }>('ns');
    expect(b.get('ent:v1:capability')).toEqual({ k: 'v' });
    now = 2_000;
    expect(b.has('short')).toBe(false);
    expect(b.entries().map(([k]) => k)).toEqual(['ent:v1:capability']);
    expect(b.delete('ent:v1:capability')).toBe(true);
    expect(b.delete('ent:v1:capability')).toBe(false);
    expect(
      () => new DurableState({ file, sealKey: new Uint8Array(32).fill(6), now: () => now }),
    ).toThrow(/cannot be opened/);
    writeFileSync(file, 'not json');
    expect(() => new DurableState({ file, sealKey: SEAL, now: () => now })).toThrow(
      /cannot be opened/,
    );
    expect(new DurableState({ sealKey: SEAL, now: () => now }).durable).toBe(false);
  });
});

describe('restart (RT-A-11)', () => {
  it('a T-24 intent survives a restart: the same session completes without spending a second proof', async () => {
    const h = await harness({ env: { STATE_FILE: stateFile() } });
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 't25-intent' });
    expect(first.res.status).toBe(503);
    const restarted = await h.restart();
    expect(restarted.deps.intents.size).toBe(1);
    expect(restarted.deps.intents.get(first.spk.toLowerCase())?.decision.kind).toBe('serve-free');
  });

  it('boot retry: a stale delivery (entitlement gone or already ready) is dropped; a failing order stays pending', async () => {
    const h = await harness({ env: { STATE_FILE: stateFile() } });
    const order = vi.spyOn(h.adapters.reseller, 'order');
    order.mockRejectedValueOnce(new AdapterError('reseller', 'unavailable', 'down'));
    const { res } = await h.claim({ seed: 't25-boot-a' });
    expect(res.status).toBe(202);
    const pending = ((await res.json()) as { entitlementKey: string }).entitlementKey;
    h.deps.pendingDelivery.set('ent:v1:gone', {
      sessionPubKey: `0x${'ab'.repeat(32)}`,
      nonce: `0x${'cd'.repeat(32)}`,
    });
    order.mockRejectedValueOnce(new AdapterError('reseller', 'unavailable', 'still down'));
    h.clock.advance(61_000);
    const restarted = await h.restart();
    expect(await retryPendingOnBoot(restarted.deps)).toEqual({ retried: 1, ready: 0 });
    expect(restarted.deps.pendingDelivery.has('ent:v1:gone')).toBe(false);
    expect(restarted.deps.pendingDelivery.has(pending)).toBe(true); // still pending: /me retries later
    h.clock.advance(61_000);
    expect(await retryPendingOnBoot(restarted.deps)).toEqual({ retried: 1, ready: 1 });
    expect(await retryPendingOnBoot(restarted.deps)).toEqual({ retried: 0, ready: 0 });
  });

  it('boot retry never throws: a ledger read failure is logged and skipped', async () => {
    const h = await harness();
    h.deps.pendingDelivery.set('ent:v1:x', {
      sessionPubKey: `0x${'ab'.repeat(32)}`,
      nonce: `0x${'cd'.repeat(32)}`,
    });
    vi.spyOn(h.deps.stores.entitlements, 'getByKey').mockRejectedValueOnce(new Error('down'));
    expect(await retryPendingOnBoot(h.deps)).toEqual({ retried: 0, ready: 0 });
    expect(h.lines.join('\n')).toContain('boot retry skipped');
  });

  it('the treasury daily cap is summed from the ledger: a restart does not reset it', async () => {
    const h = await harness({ env: { TREASURY_MAX_USD6_PER_DAY: '4000000' } });
    const a = await buyGift(h, 'bob.eth', 1000); // $4.00 each
    const b = await buyGift(h, 'bob.eth', 1000);
    h.clock.advance(7 * DAY + 1);
    expect((await reclaimGift(h, a.giftId)).status).toBe(200);
    expect(
      await h.deps.stores.receipts.spentUsd6ForDay('gift-reclaim', dayBucket(h.clock.now())),
    ).toBe(4_000_000n);
    const restarted = await h.restart();
    const payer = addressOf(HUMAN_KEY);
    const challenge = await h.challengeFor('/gift/reclaim', payerSessionKey(payer));
    const signature = await signGiftReclaim(HUMAN_KEY, h.deps.chainId, {
      giftId: b.giftId as Hex,
      nonce: challenge.nonce as Hex,
    });
    await expect(
      reclaim(restarted.deps, { giftId: b.giftId, payer, signature, challenge }),
    ).rejects.toMatchObject({ code: 'chain_unavailable' });
    expect(h.treasury.refunds()).toHaveLength(1);
    // the settled reclaim is the pending receipt patched with its tx (one receipt, not a twin)
    const rows = await h.adapters.ledger.query({
      annotations: { type: 'receipt', receiptKind: 'gift-reclaim' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toContain(h.treasury.refunds()[0]!.tx);
  });
});
