/**
 * Local-only seed hooks (T-85, AP18) used by scripts/e2e-local.sh and the demo seed. Every header is read INSIDE an
 * `if (… === 'local')` guard (semgrep `recharge-seed-hook-without-local-guard`); env.ts refuses SEED_* in live; in
 * live the headers are ignored and a request behaves exactly like a control request. Each use logs `seed-hook`.
 */
import { hashToField, hexToBytes, sha256Hex } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import { hex32Schema, type PersonhoodProof } from '@ethglobal/protocol/schemas';

import type { Ctx } from './context.js';

/** Credential levels the local World simulator can issue (POST /__local/world-proof). */
export const SIMULATED_LEVELS = ['orb', 'document', 'device'] as const;
export type SimulatedLevel = (typeof SIMULATED_LEVELS)[number];

/**
 * An IDKit-4-shaped result for the local MockPersonhood (MODE=local only; the PWA's "Simulated World ID"
 * button). Same shape as adapters/testing `fixtureProof`: Orb → a V4 `proof_of_human` response, document and
 * device → V3 legacy responses; `signal_hash = hashToField(challenge.signal)`, the nullifier is derived from
 * `seed`, so the same seed replays the same human. The verifier never trusts the tier from here (T-22).
 */
export function simulatedWorldProof(
  level: SimulatedLevel,
  signal: Hex,
  seed: string,
  opts: { action: string; environment: string; nowMs: number },
): PersonhoodProof {
  const nullifier = sha256Hex(`nullifier:${seed}`);
  const base = { nonce: sha256Hex(`nonce:${seed}`), action: opts.action };
  const signal_hash = hashToField(hexToBytes(signal));
  if (level === 'orb') {
    return {
      protocol_version: '4.0',
      ...base,
      environment: opts.environment,
      responses: [
        {
          identifier: 'proof_of_human',
          issuer_schema_id: 1,
          nullifier: BigInt(nullifier).toString(),
          expires_at_min: Math.floor(opts.nowMs / 1000) + 86_400,
          proof: [0, 1, 2, 3, 4].map((i) => sha256Hex(`proof:${seed}:${i}`)),
          signal_hash,
        },
      ],
    };
  }
  return {
    protocol_version: '3.0',
    ...base,
    environment: opts.environment,
    responses: [
      {
        identifier: level,
        merkle_root: sha256Hex(`root:${seed}`),
        nullifier,
        proof: sha256Hex(`proof:${seed}`),
        signal_hash,
        max_age: 7200,
      },
    ],
  };
}

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
