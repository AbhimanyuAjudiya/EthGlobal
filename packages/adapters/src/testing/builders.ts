/** Payload builders for tests (INTERFACES §3.4). Deterministic: same inputs, same outputs. */
import { sha256Hex } from '@ethglobal/crypto';
import { USDC_EIP712_DOMAIN, WORLD_ACTION } from '@ethglobal/protocol/ids';

import { signalHash } from '../personhood-proof.js';
import { anvilAccounts, anvilRoles } from './anvil.js';
import { T0 } from './clock.js';

import type {
  Hex,
  PaymentAuthorization,
  PaymentPayload,
  PaymentRequirementInput,
  PaymentRequirements,
  PersonhoodProof,
  VerificationLevel,
} from '../types.js';

/** A stand-in MockUSDC3009 address on Anvil (the real one comes from deploy/addresses.anvil.json). */
export const TEST_USDC = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

export function requirementInput(
  overrides: Partial<PaymentRequirementInput> = {},
): PaymentRequirementInput {
  return {
    amount: '1000000',
    asset: TEST_USDC,
    payTo: anvilAccounts[anvilRoles.payout],
    network: 'eip155:31337',
    resource: {
      url: 'http://localhost:8787/resource',
      description: 'test resource',
      mimeType: 'application/json',
    },
    extra: { ...USDC_EIP712_DOMAIN['eip155:31337'] },
    ...overrides,
  };
}

/** An exact-EVM payload for `req`, valid ±60 s around T0; the signature is a placeholder unless given. */
export function paymentPayload(
  req: PaymentRequirements,
  overrides: Partial<PaymentAuthorization> = {},
  signature: Hex = `0x${'ab'.repeat(65)}`,
): PaymentPayload {
  const nowSeconds = Math.floor(T0 / 1000);
  return {
    x402Version: 2,
    accepted: req,
    payload: {
      signature,
      authorization: {
        from: anvilAccounts[anvilRoles.human],
        to: req.payTo,
        value: req.amount,
        validAfter: String(nowSeconds - 60),
        validBefore: String(nowSeconds + 60),
        nonce: `0x${'01'.padStart(64, '0')}`,
        ...overrides,
      },
    },
  };
}

const V4_IDENTIFIER: Partial<Record<VerificationLevel, string>> = {
  orb: 'proof_of_human',
  document: 'passport',
  secure_document: 'passport',
};

/**
 * IDKit-4-shaped result (V4 `proof_of_human` for orb, `passport` for document levels; a V3 `device` response
 * for device) with `nullifier` derived from sha256(seed) and `signal_hash = hashToField(signal)` (A-25, A-26).
 * The same seed is the same human across levels.
 */
export function fixtureProof(
  level: VerificationLevel,
  signal?: Hex,
  seed = 'fixture',
): PersonhoodProof {
  const nullifier = sha256Hex(`nullifier:${seed}`);
  const base = {
    nonce: sha256Hex(`nonce:${seed}`),
    action: WORLD_ACTION,
    environment: 'production',
  };
  const signal_hash = signalHash(signal ?? '');
  const identifier = V4_IDENTIFIER[level];
  if (identifier === undefined) {
    return {
      protocol_version: '3.0',
      ...base,
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
  return {
    protocol_version: '4.0',
    ...base,
    responses: [
      {
        identifier,
        issuer_schema_id: identifier === 'passport' ? 9303 : 1,
        nullifier: BigInt(nullifier).toString(),
        expires_at_min: Math.floor(T0 / 1000) + 86_400,
        proof: [0, 1, 2, 3, 4].map((i) => sha256Hex(`proof:${seed}:${i}`)),
        signal_hash,
      },
    ],
  };
}
