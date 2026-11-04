/** CampaignStore (INTERFACES §1.4). paused/budget/spent live on-chain, never here. */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { ANN, keys, type Hex } from '@ethglobal/protocol/ids';
import { campaignSchema, type CampaignPayload } from '@ethglobal/protocol/schemas';

import {
  assertCampaignLifetime,
  campaignFromPayload,
  campaignToPayload,
  type Campaign,
} from '../campaign.js';
import { lifetimeUntil, lower, Repo, type Codec, type Found } from './common.js';

const campaignCodec: Codec<CampaignPayload> = {
  type: 'campaign',
  schema: campaignSchema,
  key: (c) => keys.campaign(c.id as Hex),
  annotations: (c) => ({ [ANN.sponsor]: lower(c.sponsor), [ANN.expiresAt]: c.expiresAt }),
  expiresIn: (c, now) => lifetimeUntil(c.expiresAt, now),
};

const toCampaign = (found: Found<CampaignPayload>): Found<Campaign> => ({
  ...found,
  payload: campaignFromPayload(found.payload),
});

export class CampaignStore {
  readonly #repo: Repo<CampaignPayload>;

  constructor(
    ledger: Ledger,
    private readonly now: () => number,
  ) {
    this.#repo = new Repo(ledger, now, campaignCodec);
  }

  async get(id: Hex): Promise<Found<Campaign> | null> {
    const found = await this.#repo.byKey(keys.campaign(id));
    return found && toCampaign(found);
  }

  /**
   * Create or replace; the payload is validated (safeTextSchema name, bundleMb.device === 0; T-70) and a campaign
   * longer than the ledger can keep its claim records is CampaignTooLongError (RT-O-08, A-44).
   */
  async put(c: Campaign): Promise<LedgerPutResult> {
    assertCampaignLifetime(c.expiresAt, this.now());
    return this.#repo.upsert(campaignToPayload(c));
  }

  async list(): Promise<Found<Campaign>[]> {
    return (await this.#repo.findAll()).map(toCampaign);
  }
}
