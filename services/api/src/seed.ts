/**
 * Local-only seed hooks (T-85, AP18) used by scripts/e2e-local.sh and the demo seed. Every header is read INSIDE an
 * `if (… === 'local')` guard (semgrep `recharge-seed-hook-without-local-guard`); env.ts refuses SEED_* in live; in
 * live the headers are ignored and a request behaves exactly like a control request. Each use logs `seed-hook`.
 */
import { hex32Schema } from '@ethglobal/protocol/schemas';

import type { Ctx } from './context.js';

const seconds = (value: string | undefined, max: number): number | undefined => {
  if (value === undefined || !/^\d{1,9}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 && n <= max ? n : undefined;
};

function logged<T>(c: Ctx, hook: string, value: T | undefined): T | undefined {
  if (value !== undefined) c.get('log').warn({ event: 'seed-hook', hook }, 'local seed hook used');
  return value;
}

/** X-Seed-Validity-S: entitlement lifetime override for /claim (local only). */
export function seedValidityS(c: Ctx): number | undefined {
  if (c.get('deps').env.MODE === 'local') {
    return logged(c, 'validity', seconds(c.req.header('x-seed-validity-s'), 30 * 86_400));
  }
  return undefined;
}

/** X-Seed-Claim-Window-S: gift claim window override for /gift (local only). */
export function seedClaimWindowS(c: Ctx): number | undefined {
  if (c.get('deps').env.MODE === 'local') {
    return logged(c, 'claim-window', seconds(c.req.header('x-seed-claim-window-s'), 30 * 86_400));
  }
  return undefined;
}

/** X-Seed-Card-Campaign: mint a campaign-funded scratch card without payment (local only). */
export function seedCardCampaign(c: Ctx): string | undefined {
  if (c.get('deps').env.MODE === 'local') {
    const value = c.req.header('x-seed-card-campaign');
    return logged(
      c,
      'card-campaign',
      value !== undefined && hex32Schema.safeParse(value).success ? value.toLowerCase() : undefined,
    );
  }
  return undefined;
}

/** The local clock offset POST /__local/clock moves (e2e time travel); the route exists only when MODE=local. */
export class LocalClock {
  #offsetMs = 0;

  constructor(private readonly base: () => number = Date.now) {}

  readonly now = (): number => this.base() + this.#offsetMs;

  advance(ms: number): void {
    this.#offsetMs += ms;
  }
}
