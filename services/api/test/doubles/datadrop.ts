/**
 * In-memory DataDrop (INTERFACES §6.1 semantics) for the in-process tests: claim reverts exactly as the contract
 * does (AlreadyClaimed, CampaignPaused, CampaignExpired, HourlyCap, BudgetExhausted), hour buckets from the injected
 * clock, pause, and per-method failure switches. The Anvil-backed run (scripts/e2e-local.sh) uses the real contract.
 */
import { getAddress, type Address } from 'viem';

import { keccak256 as keccak, concat, hexToBytes } from '@ethglobal/crypto';
import { hourBucket, type Hex } from '@ethglobal/protocol/ids';

import {
  ChainRevert,
  ChainUnavailable,
  type ChainCampaign,
  type DataDropClient,
} from '../../src/chain.js';

interface Stored extends ChainCampaign {
  claims: Set<string>;
  perHour: Map<number, number>;
}

export class MemoryDataDrop implements DataDropClient {
  readonly address: Address = getAddress('0x90193c961a926261b756d1e5bb255e67ff9498a1');
  readonly attestor: Address = getAddress('0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc');
  readonly campaigns = new Map<string, Stored>();
  readonly claimedEvents: { id: Hex; claimKey: Hex; tx: Hex }[] = [];
  readonly pauses: { id: Hex; paused: boolean }[] = [];
  /** Throw on the next call of a method (ChainUnavailable unless a revert name is given). */
  failNext: Partial<Record<'claim' | 'claimed' | 'campaign', string | true>> = {};
  #tx = 0;

  constructor(private readonly now: () => number) {}

  create(id: Hex, c: Omit<ChainCampaign, 'paused'> & { paused?: boolean }): void {
    this.campaigns.set(id.toLowerCase(), {
      paused: false,
      ...c,
      claims: new Set(),
      perHour: new Map(),
    });
  }

  #get(id: Hex): Stored | undefined {
    return this.campaigns.get(id.toLowerCase());
  }

  #fail(method: 'claim' | 'claimed' | 'campaign'): void {
    const f = this.failNext[method];
    if (f === undefined) return;
    delete this.failNext[method];
    throw f === true ? new ChainUnavailable(`${method} failed`) : new ChainRevert(f);
  }

  async campaign(id: Hex): Promise<ChainCampaign> {
    this.#fail('campaign');
    const c = this.#get(id);
    if (!c)
      return {
        sponsor: '0x0000000000000000000000000000000000000000',
        pricePerClaim: 0n,
        budget: 0n,
        spent: 0n,
        claimsPerHour: 0,
        expiresAt: 0,
        paused: false,
      };
    const { claims: _c, perHour: _p, ...rest } = c;
    return { ...rest };
  }

  async claimed(id: Hex, claimKey: Hex): Promise<boolean> {
    this.#fail('claimed');
    return this.#get(id)?.claims.has(claimKey.toLowerCase()) ?? false;
  }

  async claimsInHour(id: Hex, bucket: number): Promise<number> {
    return this.#get(id)?.perHour.get(bucket) ?? 0;
  }

  async currentHourBucket(): Promise<number> {
    return hourBucket(this.now());
  }

  async claim(id: Hex, claimKey: Hex): Promise<{ tx: Hex }> {
    this.#fail('claim');
    const c = this.#get(id);
    if (!c) throw new ChainRevert('InvalidCampaign');
    if (c.paused) throw new ChainRevert('CampaignPaused');
    if (this.now() >= c.expiresAt) throw new ChainRevert('CampaignExpired');
    const key = claimKey.toLowerCase();
    if (c.claims.has(key)) throw new ChainRevert('AlreadyClaimed');
    const bucket = hourBucket(this.now());
    const inHour = c.perHour.get(bucket) ?? 0;
    if (inHour >= c.claimsPerHour) throw new ChainRevert('HourlyCap');
    if (c.pricePerClaim > c.budget - c.spent) throw new ChainRevert('BudgetExhausted');
    c.claims.add(key);
    c.perHour.set(bucket, inHour + 1);
    c.spent += c.pricePerClaim;
    this.#tx += 1;
    const tx = keccak(concat(hexToBytes(id), hexToBytes(claimKey), Uint8Array.of(this.#tx)));
    this.claimedEvents.push({ id, claimKey, tx });
    return { tx };
  }

  async pause(id: Hex, paused: boolean): Promise<{ tx: Hex }> {
    const c = this.#get(id);
    if (!c) throw new ChainRevert('InvalidCampaign');
    c.paused = paused;
    this.pauses.push({ id, paused });
    this.#tx += 1;
    return { tx: keccak(Uint8Array.of(0xaa, this.#tx)) };
  }
}
