/** Red-team seeding through the real API (the sponsor console's own path), shared by the rt-* specs. */
import { chainReader, registerCampaign } from '../../e2e/seed-campaign';

import type { Hex } from 'viem';

export const reader = chainReader;

/** Registers a campaign named `name` from Anvil #3 (the demo sponsor wallet) — the console's own path. */
export const seedCampaign = (name: string): Promise<Hex> =>
  registerCampaign({
    name,
    budget: 24_000_000n, // 20 claims at $1.20
    maxClaims: 20,
    expiresInDays: 10,
    salt: BigInt(Date.now()) * 7n,
    clientIp: '198.18.7.1',
  });
