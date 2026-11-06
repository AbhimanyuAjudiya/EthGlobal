/** Campaign claims and printed cards share one lifetime/budget capacity, including transactions in flight. */
import { describe, expect, it, vi } from 'vitest';

import { sponsorCardsResponseSchema } from '@ethglobal/protocol/schemas';

import { sponsorCardsRequest } from './support/client.js';
import {
  errorOf,
  harness,
  redeemPin,
  seedCard,
  SPONSOR_KEY,
  type Harness,
} from './support/harness.js';

async function cap(h: Harness, maxClaims: number) {
  const campaign = await h.deps.stores.campaigns.get(h.campaignId);
  await h.deps.stores.campaigns.put({ ...campaign!.payload, maxClaims });
}

async function mint(h: Harness, count: number) {
  const body = await sponsorCardsRequest(SPONSOR_KEY, h.deps.chainId, h.campaignId, {
    count,
    mb: 300,
    issuedAt: h.clock.now(),
  });
  return h.json(`/sponsor/${h.campaignId}/cards`, body);
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('shared campaign capacity for cards and free claims', () => {
  it('counts spent claims and outstanding cards against maxClaims even with ample budget', async () => {
    const h = await harness();
    await cap(h, 3);
    const first = sponsorCardsResponseSchema.parse(await (await mint(h, 2)).json());
    expect((await redeemPin(h, first.cards[0]!.pin)).status).toBe(201);
    expect((await mint(h, 1)).status).toBe(201);
    expect(await errorOf(await mint(h, 1))).toBe('budget_exhausted');
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(2);
  });

  it('concurrent batches cannot promise more cards than the lifetime cap', async () => {
    const h = await harness();
    await cap(h, 3);
    const results = await Promise.all([mint(h, 2), mint(h, 2)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(2);
  });

  it('a legacy overprinted card is refused before its PIN is consumed when the cap is already spent', async () => {
    const h = await harness();
    await cap(h, 1);
    const card = await seedCard(h);
    await h.dataDrop.claim(h.campaignId, `0x${'fe'.repeat(32)}`);
    expect(await errorOf(await redeemPin(h, card.pin))).toBe('budget_exhausted');
    expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(1);
    expect(h.reseller.orders()).toHaveLength(0);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('the last printed card blocks ordinary free admission before World ID verification', async () => {
    const h = await harness();
    await cap(h, 1);
    const batch = sponsorCardsResponseSchema.parse(await (await mint(h, 1)).json());
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    expect(await errorOf((await h.claim({ seed: 'printed-slot' })).res)).toBe('budget_exhausted');
    expect(verify).not.toHaveBeenCalled();
    expect((await redeemPin(h, batch.cards[0]!.pin)).status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('a free claim awaiting verification reserves capacity against a concurrent print batch', async () => {
    const h = await harness();
    await cap(h, 1);
    const started = gate();
    const resume = gate();
    const original = h.adapters.personhood.verify.bind(h.adapters.personhood);
    vi.spyOn(h.adapters.personhood, 'verify').mockImplementation(async (...args) => {
      started.release();
      await resume.promise;
      return original(...args);
    });
    const claim = h.claim({ seed: 'verification-reservation' });
    await started.promise;
    try {
      expect(await errorOf(await mint(h, 1))).toBe('budget_exhausted');
    } finally {
      resume.release();
    }
    expect((await claim).res.status).toBe(201);
    expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(0);
  });

  it('card redemption shares the hourly reservation with a free claim still awaiting verification', async () => {
    const h = await harness({ campaign: { claimsPerHour: 1 } });
    await cap(h, 2);
    const card = await seedCard(h);
    const started = gate();
    const resume = gate();
    const original = h.adapters.personhood.verify.bind(h.adapters.personhood);
    vi.spyOn(h.adapters.personhood, 'verify').mockImplementation(async (...args) => {
      started.release();
      await resume.promise;
      return original(...args);
    });
    const claim = h.claim({ seed: 'shared-hourly-reservation' });
    await started.promise;
    try {
      expect(await errorOf(await redeemPin(h, card.pin))).toBe('hourly_cap');
      expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(1);
    } finally {
      resume.release();
    }
    expect((await claim).res.status).toBe(201);
    h.clock.advance(60 * 60_000);
    // The separate anomaly policy pauses a 1/hour campaign after its first claim; its sponsor resumes it.
    await h.dataDrop.pause(h.campaignId, false);
    expect((await redeemPin(h, card.pin)).status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(2);
  });

  it('minting waits for an in-flight chain claim and sees the spent counter before promising a card', async () => {
    const h = await harness();
    await cap(h, 1);
    const started = gate();
    const resume = gate();
    const queuedMint = gate();
    const originalClaim = h.dataDrop.claim.bind(h.dataDrop);
    vi.spyOn(h.dataDrop, 'claim').mockImplementation(async (...args) => {
      started.release();
      await resume.promise;
      return originalClaim(...args);
    });
    const claim = h.claim({ seed: 'chain-reservation' });
    await started.promise;
    const originalRun = h.deps.mutex.run.bind(h.deps.mutex);
    vi.spyOn(h.deps.mutex, 'run').mockImplementation((key, task) => {
      if (key === `campaign:${h.campaignId}`) queuedMint.release();
      return originalRun(key, task);
    });
    const batch = mint(h, 1);
    await queuedMint.promise;
    resume.release();
    expect((await claim).res.status).toBe(201);
    expect(await errorOf(await batch)).toBe('budget_exhausted');
    expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(0);
  });

  it('failed card settlement keeps its promise and can retry without a free claim stealing the slot', async () => {
    const h = await harness();
    await cap(h, 1);
    const card = await seedCard(h);
    h.dataDrop.failNext.claim = true;
    expect(await errorOf(await redeemPin(h, card.pin))).toBe('chain_unavailable');
    expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(1);
    expect(h.deps.admission.inFlight(h.campaignId)).toBe(0);
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    expect(await errorOf((await h.claim({ seed: 'cannot-steal' })).res)).toBe('budget_exhausted');
    expect(verify).not.toHaveBeenCalled();
    expect((await redeemPin(h, card.pin)).status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('recovers the exact mined card after a ledger failure even when the campaign is now paused and capped', async () => {
    const h = await harness();
    await cap(h, 1);
    const card = await seedCard(h);
    vi.spyOn(h.deps.stores.gifts, 'markClaimed').mockRejectedValueOnce(new Error('ledger down'));
    expect((await redeemPin(h, card.pin)).status).toBe(500);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    await h.dataDrop.pause(h.campaignId, true);
    expect((await redeemPin(h, card.pin)).status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    expect(h.reseller.orders()).toHaveLength(1);
  });

  it('an uncertain free chain result keeps its slot against both card minting and legacy card redemption', async () => {
    const h = await harness();
    await cap(h, 1);
    h.dataDrop.failNext.claim = true;
    expect(await errorOf((await h.claim({ seed: 'uncertain-free-claim' })).res)).toBe(
      'chain_unavailable',
    );
    expect(h.deps.admission.inFlight(h.campaignId)).toBe(0);
    // The transient admission slot is gone, but the durable uncertain-chain reservation remains.
    expect(await errorOf(await mint(h, 1))).toBe('budget_exhausted');
    // Local seeding models a legacy card printed before this capacity protection existed.
    const card = await seedCard(h);
    expect(await errorOf(await redeemPin(h, card.pin))).toBe('budget_exhausted');
    expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(1);
    expect(h.dataDrop.claimedEvents).toHaveLength(0);
    expect(h.reseller.orders()).toHaveLength(0);
  });

  it('waits for every partial batch write before admitting another batch', async () => {
    const h = await harness();
    await cap(h, 2);
    const started = gate();
    const resume = gate();
    const original = h.deps.stores.gifts.create.bind(h.deps.stores.gifts);
    let writes = 0;
    vi.spyOn(h.deps.stores.gifts, 'create').mockImplementation(async (...args) => {
      writes += 1;
      if (writes === 1) throw new Error('first write failed');
      if (writes === 2) {
        started.release();
        await resume.promise;
      }
      return original(...args);
    });
    const failedBatch = mint(h, 2);
    await started.promise;
    const nextBatch = mint(h, 2);
    resume.release();
    expect((await failedBatch).status).toBe(500);
    expect(await errorOf(await nextBatch)).toBe('budget_exhausted');
    expect(await h.deps.stores.gifts.openCampaignCards(h.campaignId)).toHaveLength(1);
  });
});
