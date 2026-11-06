/** `@ethglobal/octroi`: the proof-or-pay quota engine (INTERFACES §5). Stores live in `./store`. */
export { tierFromLevel, type Tier } from './tier.js';
export {
  assertCampaignLifetime,
  campaignFromPayload,
  campaignToPayload,
  remainingCampaignClaims,
  CampaignTooLongError,
  CLAIM_RECORD_GRACE_MS,
  MAX_CAMPAIGN_MS,
  type Campaign,
  type CampaignCounters,
} from './campaign.js';
export {
  auditKey,
  campaignClaimKey,
  entitlementIndex,
  freeEntitlementKey,
  giftEntitlementKey,
  holderHash,
  INDEX_PREFIX,
  MIN_SECRET_BYTES,
  onchainClaimKey,
  paidEntitlementKey,
  quotaKey,
} from './keys.js';
export { sizeBundle } from './size.js';
export {
  challenge,
  consumeChallenge,
  signalFor,
  type Challenge,
  type ConsumeResult,
} from './challenge.js';
export {
  buildAccepts,
  decide,
  DEVICE_TIER_DETAIL,
  type DecideRequest,
  type Decision,
  type DenyReason,
  type Entitlement,
  type OctroiDeps,
} from './decide.js';
export {
  policyFromWire,
  policyToWire,
  shouldTopUp,
  type TopUpPolicy,
  type TopUpVerdict,
} from './topup.js';
export { decideGiftReclaim, type GiftReclaimVerdict } from './gift.js';
export * from './store/index.js';
