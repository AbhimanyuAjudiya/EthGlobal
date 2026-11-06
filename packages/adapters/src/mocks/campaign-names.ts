/** MODE=local and tests: CampaignNames in memory — same checks and step order as live, fake transaction hashes. */
import { getAddress, keccak256, toBytes, type Address, type Hex } from 'viem';

import { ENS_SLUG_PATTERN } from '@ethglobal/protocol/ids';

import { AdapterError } from '../errors.js';

import type {
  CampaignNameInput,
  CampaignNameResult,
  CampaignNames,
  CampaignNameStep,
} from '../types.js';

export interface MockCampaignName {
  campaignId: Hex;
  sponsor: Address;
  resolver: Address;
  expiresAt: number;
  records: Record<string, string>;
}

export class MockCampaignNames implements CampaignNames {
  readonly parent: string;
  readonly names = new Map<string, MockCampaignName>();
  /** Calls to fail (AdapterError unavailable) before the next one succeeds. */
  failNext = 0;
  readonly #now: () => number;

  constructor(opts: { parent?: string; now?: () => number } = {}) {
    this.parent = opts.parent ?? 're-charge.eth';
    this.#now = opts.now ?? Date.now;
  }

  isAvailable(label: string): Promise<boolean> {
    const held = this.names.get(label);
    return Promise.resolve(held === undefined || held.expiresAt <= this.#now());
  }

  async ensureCampaignName(input: CampaignNameInput): Promise<CampaignNameResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new AdapterError('names', 'unavailable', 'ens: mock outage');
    }
    if (!ENS_SLUG_PATTERN.test(input.slug))
      throw new AdapterError('names', 'invalid_name', 'ens: slug is not [a-z0-9-], 3–40');
    if (input.expiresAt <= this.#now())
      throw new AdapterError('names', 'invalid_expiry', 'ens: the campaign has ended');
    const name = `${input.slug}.${this.parent}`;
    const resolver = getAddress(`0x${keccak256(input.campaignId).slice(-40)}`);
    const held = this.names.get(input.slug);
    if (held && held.expiresAt > this.#now()) {
      if (held.campaignId !== input.campaignId)
        throw new AdapterError('names', 'conflict', `ens: ${name} belongs to another campaign`);
      return { name, resolver, txs: [] };
    }
    const txs: CampaignNameResult['txs'] = [];
    for (const step of ['resolver', 'register', 'grant'] as CampaignNameStep[]) {
      const hash = keccak256(toBytes(`mock-ens:${step}:${input.campaignId}`));
      txs.push({ step, hash });
      await input.onTx?.(step, hash);
    }
    this.names.set(input.slug, {
      campaignId: input.campaignId,
      sponsor: getAddress(input.sponsor),
      resolver,
      expiresAt: input.expiresAt,
      records: { ...input.records },
    });
    return { name, resolver, txs };
  }
}
