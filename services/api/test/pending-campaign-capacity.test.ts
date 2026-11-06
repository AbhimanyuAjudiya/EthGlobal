import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type { ChallengeWire } from '@ethglobal/protocol/schemas';

import { DAY, errorOf, harness, redeemPin, seedCard, type Harness } from './support/harness.js';
import { pendingCampaignClaims } from '../src/middleware/octroi.js';

import type { createApp } from '../src/app.js';

async function cap(h: Harness, maxClaims: number) {
  const found = await h.deps.stores.campaigns.get(h.campaignId);
  await h.deps.stores.campaigns.put({ ...found!.payload, maxClaims });
}

async function claim(app: ReturnType<typeof createApp>, h: Harness, seed: string, spk?: Hex) {
  const sessionPubKey = spk ?? bytesToHex(generateSessionKeypair().publicKey);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const challenge = (await (
    await post('/challenge', { audience: 'recharge', path: '/claim', sessionPubKey })
  ).json()) as ChallengeWire;
  return post('/claim', {
    sessionPubKey,
    campaignId: h.campaignId,
    challenge,
    proof: fixtureProof('orb', challenge.signal as Hex, seed),
  });
}

describe('unknown chain outcomes reserve campaign capacity', () => {
  it('retains only the unresolved slot across restart and lets its original human finish it', async () => {
    const h = await harness({
      env: { STATE_FILE: join(mkdtempSync(join(tmpdir(), 'campaign-pending-')), 'state') },
    });
    await cap(h, 2);
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 'unknown-first' });
    expect(first.res.status).toBe(503);
    expect((await h.claim({ seed: 'available-second' })).res.status).toBe(201);
    const restarted = await h.restart();
    expect(await pendingCampaignClaims(restarted.deps, h.campaignId)).toBe(1);
    expect(await errorOf(await claim(restarted.app, h, 'cannot-overbook'))).toBe(
      'budget_exhausted',
    );
    expect((await claim(restarted.app, h, 'unknown-first', first.spk)).status).toBe(201);
    expect(await pendingCampaignClaims(restarted.deps, h.campaignId)).toBe(0);
    expect(h.dataDrop.claimedEvents).toHaveLength(2);
    expect(h.reseller.orders()).toHaveLength(2);
  });

  it('keeps an unresolved slot past plan expiry without resurrecting that expired plan', async () => {
    const h = await harness({
      env: { STATE_FILE: join(mkdtempSync(join(tmpdir(), 'campaign-expired-')), 'state') },
    });
    await cap(h, 1);
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 'unknown-expired' });
    expect(first.res.status).toBe(503);
    h.clock.advance(8 * DAY);
    const restarted = await h.restart();
    expect(await pendingCampaignClaims(restarted.deps, h.campaignId)).toBe(1);
    expect(await errorOf(await claim(restarted.app, h, 'cannot-reuse-unknown'))).toBe(
      'budget_exhausted',
    );
    expect(await errorOf(await claim(restarted.app, h, 'unknown-expired', first.spk))).toBe(
      'expired',
    );
    expect(h.dataDrop.claimedEvents).toHaveLength(0);
    expect(h.reseller.orders()).toHaveLength(0);
  });

  it('releases a definitively reverted first attempt instead of reserving phantom capacity', async () => {
    const h = await harness();
    await cap(h, 1);
    h.dataDrop.failNext.claim = 'HourlyCap';
    expect(await errorOf((await h.claim({ seed: 'definitive-revert' })).res)).toBe('hourly_cap');
    expect(await pendingCampaignClaims(h.deps, h.campaignId)).toBe(0);
    expect((await h.claim({ seed: 'after-revert' })).res.status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('deduplicates an open card promise, then preserves its unknown transaction after PIN expiry and restart', async () => {
    const h = await harness({
      env: { STATE_FILE: join(mkdtempSync(join(tmpdir(), 'campaign-card-pending-')), 'state') },
    });
    await cap(h, 2);
    const card = await seedCard(h);
    h.dataDrop.failNext.claim = true;
    expect(await errorOf(await redeemPin(h, card.pin))).toBe('chain_unavailable');
    expect(h.deps.pendingCardClaims.size).toBe(1);
    // The marker and the still-open PIN represent one promised claim, leaving the second slot available.
    expect((await h.claim({ seed: 'beside-unknown-card' })).res.status).toBe(201);
    h.clock.advance(card.claimBy - h.clock.now() + 1);
    const restarted = await h.restart();
    expect(await restarted.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(0);
    expect(await pendingCampaignClaims(restarted.deps, h.campaignId)).toBe(1);
    expect(await errorOf(await claim(restarted.app, h, 'after-pin-expiry'))).toBe(
      'budget_exhausted',
    );
    expect((await redeemPin(h, card.pin)).status).not.toBe(201);
    const [, pending] = restarted.deps.pendingCardClaims.entries()[0]!;
    // A late confirmation moves the reservation into the chain's spent counter, never a second allocation.
    await h.dataDrop.claim(h.campaignId, pending.claimKey);
    expect(await pendingCampaignClaims(restarted.deps, h.campaignId)).toBe(0);
    expect(await errorOf(await claim(restarted.app, h, 'after-late-confirmation'))).toBe(
      'budget_exhausted',
    );
    expect(h.dataDrop.claimedEvents).toHaveLength(2);
    expect(h.reseller.orders()).toHaveLength(1);
  });
});
