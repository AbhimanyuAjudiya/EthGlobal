/**
 * Pseudonymous keys (INTERFACES §5, A-9; T-18, T-29). Every key is HMAC-SHA256 over bytes with a distinct
 * domain prefix; inputs are hex32 and case-insensitive (bytes are hashed, never the hex text).
 */
import { concat, hexToBytes, hmacKey, hmacSha256, keccak256 } from '@ethglobal/crypto';
import { RechargeError } from '@ethglobal/protocol/errors';
import type { Hex } from '@ethglobal/protocol/ids';

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
