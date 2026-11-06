/** Event names, topics and headers — the one list (INTERFACES §1.10, §9). */

export const DATADROP_EVENTS = [
  'ModeSet',
  'CampaignCreated',
  'Claimed',
  'Paused',
  'Refunded',
  'AttestorSet',
] as const;
export type DataDropEvent = (typeof DATADROP_EVENTS)[number];

export const DATADROP_ERRORS = [
  'AlreadyClaimed',
  'CampaignPaused',
  'CampaignExpired',
  'HourlyCap',
  'BudgetExhausted',
  'CampaignExists',
  'NotAttestor',
  'NotSponsor',
  'NotRefundable',
  'InvalidCampaign',
  'NotHedera',
] as const;
export type DataDropError = (typeof DATADROP_ERRORS)[number];

/** MockUSDC3009 (Circle FiatTokenV2_2 layout). */
export const USDC3009_EVENTS = ['Transfer', 'AuthorizationUsed', 'AuthorizationCanceled'] as const;

export const HCS_TYPES = [
  'claim',
  'settle',
  'gift',
  'gift-claim',
  'gift-reclaim',
  'card-redeem',
  'agent-topup',
  'agent-pass',
  'plan-cancel',
] as const;
export type HcsType = (typeof HCS_TYPES)[number];

/** pino `event` field values; the only structured log vocabulary (ARCHITECTURE §9). */
export const LOG_EVENTS = [
  'request',
  'decision',
  'claim.tx',
  'settle',
  'provision',
  'topup',
  'webhook',
  'ledger.op',
  'cache',
  'agent.tick',
  'agent.buy',
  'agent.skip',
  'agent.pass',
  'degraded',
] as const;
export type LogEvent = (typeof LOG_EVENTS)[number];

/** HTTP headers other than the x402 ones (those live in `./x402`) and the mock webhook ones (`./schemas`). */
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
/** `Authorization: Recharge-Sponsor <base64 {sponsor, issuedAt, signature}>`. */
export const SPONSOR_AUTH_SCHEME = 'Recharge-Sponsor';
