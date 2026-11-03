/** Shared field schemas (INTERFACES §1.3). Every wire and ledger shape is built from these. */
import { z } from 'zod';

export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, 'hex');
export const hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'bytes32');
export const hex24Schema = z.string().regex(/^0x[0-9a-fA-F]{48}$/, 'bytes24');
export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'address');
export const hederaAccountSchema = z.string().regex(/^0\.0\.\d{1,12}$/, 'hedera account');
/** Usd6 (and any base-unit amount) on the wire. */
export const digitsSchema = z.string().regex(/^\d{1,30}$/, 'integer string');
/** CAIP-2 `namespace:reference`; the same character classes as @x402/core 2.29.0 `NetworkSchemaV2`. */
export const caipNetworkSchema = z
  .string()
  .regex(/^[a-z0-9-]{3,8}:[A-Za-z0-9._-]{1,32}$/, 'caip-2');
export const msSchema = z.int().nonnegative();
export const mbSchema = z.int().nonnegative().max(1_000_000);
export const tierSchema = z.enum(['orb', 'document', 'device', 'none']);
export type Tier = z.infer<typeof tierSchema>;
export const verificationLevelSchema = z.enum(['orb', 'device', 'document', 'secure_document']);
export type VerificationLevel = z.infer<typeof verificationLevelSchema>;

/** Printable ASCII + Devanagari block only (T-70). */
export const safeTextSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // The Devanagari block includes combining vowel signs; allowing them is the point (T-70).
    // eslint-disable-next-line no-misleading-character-class
    .regex(/^[\x20-\x7Eऀ-ॿ]+$/, 'safe text');

/**
 * LPA activation string (GSMA SGP.22): `LPA:1$<SM-DP+ FQDN>$<matching id>[$<SM-DP+ OID>[$1]]`. The OID
 * segment may be empty; the trailing `$1` flags that a confirmation code is required (T-39).
 */
export const LPA_PATTERN = /^LPA:1\$[A-Za-z0-9.-]+\$[A-Za-z0-9-]+(\$[A-Za-z0-9.-]*(\$[01])?)?$/;
export const lpaSchema = z.string().max(255).regex(LPA_PATTERN, 'lpa');

export const sealedBoxSchema = z.object({
  v: z.literal(1),
  epk: hex32Schema,
  nonce: hex24Schema,
  ct: hexSchema,
});
export type SealedBox = z.infer<typeof sealedBoxSchema>;
