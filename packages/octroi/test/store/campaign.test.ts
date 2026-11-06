import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';

import {
  campaignFromPayload,
  campaignToPayload,
  remainingCampaignClaims,
  type Campaign,
} from '../../src/index.js';
import { CampaignStore } from '../../src/store/index.js';
import { campaign, CAMPAIGN_ID, T0 } from '../helpers.js';

const setup = () => new CampaignStore(new InMemoryLedger({ now: () => T0 }), () => T0);

describe('remainingCampaignClaims', () => {
  it.each([
    [100_000_000n, 500_000n, 1],
    [100_000_000n, 1_000_000n, 0],
    [500_000n, 0n, 1],
    [500_000n, 500_000n, 0],
    [500_000n, 1_000_000n, 0],
    [2n ** 127n, 0n, 2],
  ])(
    'budget %s and spent %s leave %s claims under a two-claim cap',
    (budgetUsd6, spentUsd6, expected) => {
      expect(remainingCampaignClaims(campaign({ maxClaims: 2 }), { budgetUsd6, spentUsd6 })).toBe(
        expected,
      );
    },
  );
});

describe('CampaignStore', () => {
  it('put/get/list round-trip bigint money through digit strings; put replaces', async () => {
    const store = setup();
    await store.put(campaign({ actionCheck: async () => true }));
    const found = await store.get(CAMPAIGN_ID);
    expect(found?.payload).toEqual(campaign());
    await store.put(campaign({ claimsPerHour: 9 }));
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.payload.claimsPerHour).toBe(9);
    expect(await store.get(`0x${'00'.repeat(32)}`)).toBeNull();
  });

  it.each<[string, Partial<Campaign>]>([
    ['unsafe name', { name: 'evil\n<script>' }],
    ['device bundle', { bundleMb: { orb: 300, document: 300, device: 100 as 0 } }],
    ['negative money', { pricePerClaimUsd6: -1n }],
  ])('put rejects %s (T-70)', async (_n, over) => {
    await expect(setup().put(campaign(over))).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('payload conversion validates both ways', () => {
    const payload = campaignToPayload(campaign());
    expect(payload).toMatchObject({
      v: 1,
      pricePerClaimUsd6: '500000',
      wholesaleUsd6PerGb: '1140000',
    });
    expect(campaignFromPayload(payload)).toEqual(campaign());
    expect(() => campaignFromPayload({ ...payload, idResaleUsd6: '0.5' })).toThrow();
  });
});
