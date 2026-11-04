/** Campaign (ledger payload ⇄ engine shape) and the chain-side counters (INTERFACES §5). */
import { MAX_LEDGER_EXPIRES_IN_S } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import type { Hex } from '@ethglobal/protocol/ids';
import { campaignSchema, type CampaignPayload } from '@ethglobal/protocol/schemas';
import { usd6FromWire, usd6ToWire } from '@ethglobal/protocol/units';

export interface Campaign extends Omit<
  CampaignPayload,
  'pricePerClaimUsd6' | 'wholesaleUsd6PerGb' | 'idResaleUsd6' | 'v'
> {
  pricePerClaimUsd6: bigint;
  wholesaleUsd6PerGb: bigint;
  idResaleUsd6: bigint;
  /** v1: action-conditioned campaigns (DECISION Table D §2(1)b). Never persisted. */
  actionCheck?: (claimKey: Hex) => Promise<boolean>;
}

/** Chain-side facts the caller reads from DataDrop before decide() (T-24: before verify). */
export interface CampaignCounters {
  paused: boolean;
  budgetUsd6: bigint;
  spentUsd6: bigint;
  claimsThisHour: number;
  hourBucket: number;
  claimed?: boolean;
}

/** Throws RechargeError('invalid_request') with the zod issues when `value` is not a valid campaign payload. */
export function parseCampaignPayload(value: unknown): CampaignPayload {
  const parsed = campaignSchema.safeParse(value);
  if (!parsed.success) {
    throw new RechargeError('invalid_request', 'invalid campaign', parsed.error.issues);
  }
  return parsed.data;
}

export function campaignFromPayload(p: CampaignPayload): Campaign {
  const { v: _v, ...rest } = parseCampaignPayload(p);
  return {
    ...rest,
    pricePerClaimUsd6: usd6FromWire(rest.pricePerClaimUsd6),
    wholesaleUsd6PerGb: usd6FromWire(rest.wholesaleUsd6PerGb),
    idResaleUsd6: usd6FromWire(rest.idResaleUsd6),
  };
}

/** The persisted shape; `actionCheck` is code, not data, and is dropped. Validated (T-70). */
export function campaignToPayload(c: Campaign): CampaignPayload {
  const { actionCheck: _check, ...rest } = c;
  return parseCampaignPayload({
    ...rest,
    v: 1,
    pricePerClaimUsd6: usd6ToWire(c.pricePerClaimUsd6),
    wholesaleUsd6PerGb: usd6ToWire(c.wholesaleUsd6PerGb),
    idResaleUsd6: usd6ToWire(c.idResaleUsd6),
  });
}

/** How long the per-campaign claim record outlives its campaign (A-44, RT-O-08): late chain reads, clock skew. */
export const CLAIM_RECORD_GRACE_MS = 86_400_000;

/**
 * The longest a campaign may still run from `now`: its claim record (`expiresAt` + grace) must fit the ledger's
 * maximum entity lifetime (Arkiv ~182.5 d, A-24), or one human could claim it twice once the record dies (RT-O-08).
 */
export const MAX_CAMPAIGN_MS = MAX_LEDGER_EXPIRES_IN_S * 1000 - CLAIM_RECORD_GRACE_MS;

/** A campaign whose end the ledger cannot outlive (RechargeError 'invalid_request', HTTP 400). */
export class CampaignTooLongError extends RechargeError {
  constructor(
    readonly expiresAt: number,
    readonly maxExpiresAt: number,
  ) {
    super('invalid_request', 'campaign_too_long', {
      reason: 'campaign_too_long',
      expiresAt,
      maxExpiresAt,
    });
  }
}

/** Throws CampaignTooLongError when `expiresAt` is more than MAX_CAMPAIGN_MS after `now`. */
export function assertCampaignLifetime(expiresAt: number, now: number): void {
  if (expiresAt - now > MAX_CAMPAIGN_MS) {
    throw new CampaignTooLongError(expiresAt, now + MAX_CAMPAIGN_MS);
  }
}
