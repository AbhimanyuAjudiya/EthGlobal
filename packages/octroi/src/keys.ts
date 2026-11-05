/**
 * Pseudonymous keys (INTERFACES §5, A-9; T-18, T-29). Every key is HMAC-SHA256 over bytes with a distinct
 * domain prefix; inputs are hex32 and case-insensitive (bytes are hashed, never the hex text).
 */
import {
  concat,
  hexToBytes,
  hmacKey,
  hmacSha256,
  keccak256,
  sha256Hex,
  utf8,
} from '@ethglobal/crypto';
import { RechargeError } from '@ethglobal/protocol/errors';
import { keys, type Hex } from '@ethglobal/protocol/ids';

/** OCTROI_SECRET and every derived HMAC key are at least 32 bytes (T-29). */
export const MIN_SECRET_BYTES = 32;

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/** Throws RechargeError('internal_error') for a key shorter than 32 bytes: a weak secret is a deploy bug. */
export function assertSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.length < MIN_SECRET_BYTES) {
    throw new RechargeError(
      'internal_error',
      `HMAC secret must be at least ${MIN_SECRET_BYTES} bytes`,
    );
  }
}

/** hex32 → 32 bytes; throws RechargeError('invalid_request') otherwise. */
export function hex32Bytes(value: Hex, name: string): Uint8Array {
  if (typeof value !== 'string' || !HEX32.test(value)) {
    throw new RechargeError('invalid_request', `${name} must be 32 bytes of hex`);
  }
  return hexToBytes(value);
}

/** HMAC(secret, 'quota' ‖ nullifier): the global pseudonym, server-side only. */
export function quotaKey(secret: Uint8Array, nullifierHash: Hex): Hex {
  assertSecret(secret);
  return hmacKey(secret, 'quota', hex32Bytes(nullifierHash, 'nullifierHash'));
}

/** HMAC(secret, 'audit' ‖ campaignId): handed to the sponsor once. */
export function auditKey(secret: Uint8Array, campaignId: Hex): Uint8Array {
  assertSecret(secret);
  return hmacSha256(secret, 'audit', hex32Bytes(campaignId, 'campaignId'));
}

/** HMAC(audit, nullifier): the published, per-campaign pseudonym (unlinkable across campaigns). */
export function campaignClaimKey(audit: Uint8Array, nullifierHash: Hex): Hex {
  assertSecret(audit);
  return hmacKey(audit, hex32Bytes(nullifierHash, 'nullifierHash'));
}

/** keccak256(abi.encodePacked(bytes32 campaignId, bytes32 cck)) = the DataDrop claimKey. */
export function onchainClaimKey(campaignId: Hex, cck: Hex): Hex {
  return keccak256(
    concat(hex32Bytes(campaignId, 'campaignId'), hex32Bytes(cck, 'campaignClaimKey')),
  );
}

// ───────────────────────────── capabilities and their ledger index (A-34, RT-O-01) ─────────────────────────────

/** Prefix of an entitlement's ledger index; a value with it is an index, never a capability. */
export const INDEX_PREFIX = 'hk:';

/**
 * `hk:` + sha256(utf8(key)): what the ledger stores instead of an entitlement capability (annotation AND payload).
 * The same digest as a receipt's `entitlementKeyHash`. Idempotent: an index maps to itself. Every capability is
 * ≥ 256 bits of HMAC output, so the digest cannot be inverted; it needs no secret, so every store instance
 * (API, agent, tests) indexes identically.
 */
export const entitlementIndex = (key: string): string =>
  key.startsWith(INDEX_PREFIX) ? key : `${INDEX_PREFIX}${sha256Hex(utf8(key))}`;

/**
 * The free entitlement's capability (`/me/:key`): `ent:v1:` + HMAC(secret, 'entfree' ‖ campaignId ‖ nullifier).
 * Per campaign, so two campaigns' entitlements share no identifier (A-9); the global quotaKey never leaves the
 * process (it only keys the live lock, see claimLockKeys).
 */
export function freeEntitlementKey(
  secret: Uint8Array,
  campaignId: Hex,
  nullifierHash: Hex,
): string {
  assertSecret(secret);
  return keys.entitlementFree(
    hmacKey(
      secret,
      'entfree',
      hex32Bytes(campaignId, 'campaignId'),
      hex32Bytes(nullifierHash, 'nullifierHash'),
    ),
  );
}

/**
 * The paid entitlement's capability: `paid:<payer>:` + HMAC(secret, 'paid' ‖ network ‖ payer ‖ nonce-or-tx). The
 * payer and nonce are public chain data; the HMAC makes the capability underivable from them (RT-O-01 case 3).
 */
export function paidEntitlementKey(
  secret: Uint8Array,
  network: string,
  payer: string,
  nonce: string,
): string {
  assertSecret(secret);
  const tag = hmacKey(
    secret,
    'paid',
    utf8(`${network}\n${payer.toLowerCase()}\n${nonce.toLowerCase()}`),
  );
  return keys.entitlementPaid(payer, tag);
}

const dayBytes = (day: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, day);
  return out;
};

/**
 * The claim-lock keys of one human (A-33, RT-O-03/08, A-44), each an opaque `claim:` + HMAC:
 * - `live(day)`: HMAC(secret, 'live' ‖ quotaKey ‖ day) — "this human holds a live free bundle". A claim on day D
 *   reserves BOTH `live(D)` and `live(D+1)` (A-44), so two concurrent claims either side of 00:00 UTC contend for
 *   the same key (D+1) and exactly one create-if-absent wins (RT-O-03 midnight variant). Day-keyed so a claim
 *   ≥ 2 days after the previous one shares no identifier with it (A-9, RT-O-01);
 * - `campaign`: HMAC(secret, 'claimed' ‖ campaignId ‖ quotaKey) — "this human claimed this campaign" (the
 *   ledger's mirror of DataDrop.claimed: campaign + nullifier, no day; held until the campaign ends + grace,
 *   RT-O-08; links nothing across campaigns).
 */
export function claimLockKeys(
  secret: Uint8Array,
  campaignId: Hex,
  quota: Hex,
): { live: (day: number) => string; campaign: string } {
  assertSecret(secret);
  const q = hex32Bytes(quota, 'quotaKey');
  return {
    live: (day) => keys.claim(hmacKey(secret, 'live', q, dayBytes(day))),
    campaign: keys.claim(hmacKey(secret, 'claimed', hex32Bytes(campaignId, 'campaignId'), q)),
  };
}

/** The settlement marker of one on-chain payment (A-33, RT-O-05): HMAC(secret, 'settle' ‖ network ‖ tx). */
export function settlementLockKey(secret: Uint8Array, network: string, tx: string): string {
  assertSecret(secret);
  return keys.claim(hmacKey(secret, 'settle', utf8(`${network}\n${tx.toLowerCase()}`)));
}

/** sha256(utf8(key) ‖ sessionPubKey): the entitlement's holder binding (A-35, T-73 b). */
export function holderHash(entitlementKey: string, sessionPubKey: Hex): Hex {
  return sha256Hex(concat(utf8(entitlementKey), hex32Bytes(sessionPubKey, 'sessionPubKey')));
}
