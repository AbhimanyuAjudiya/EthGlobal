import { isEvmExact, type EvmExactPayload } from '@ethglobal/protocol/schemas';

import { AdapterError } from '../errors.js';
import { isHex, sha256Hex } from '../hash.js';

import type {
  PaymentPayload,
  PaymentRail,
  PaymentRequired,
  PaymentRequirementInput,
  PaymentRequirements,
  SettleResult,
  VerifyResult,
} from '../types.js';

export interface MockPaymentRailOptions {
  /** Clock in ms since epoch; inject a fake one to test validity windows. */
  now?: () => number;
}

const DEFAULT_TIMEOUT_SECONDS = 300;
const INTEGER = /^\d+$/;

/**
 * Facilitator stand-in. `verify` checks that the payload matches the requirements and is inside its
 * validity window; `settle` additionally burns the nonce and returns a deterministic transaction hash.
 * Signatures are only checked for shape; the live adapter verifies EIP-3009 authorizations onchain.
 */
export class MockPaymentRail implements PaymentRail {
  readonly #usedNonces = new Set<string>();
  readonly #now: () => number;

  constructor(options: MockPaymentRailOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  createPaymentRequirement(input: PaymentRequirementInput): PaymentRequired {
    if (!INTEGER.test(input.amount)) {
      throw new AdapterError(
        'payments',
        'invalid_amount',
        'amount must be an integer string in base units',
      );
    }
    const requirements: PaymentRequirements = {
      scheme: 'exact',
      network: input.network,
      asset: input.asset,
      amount: input.amount,
      payTo: input.payTo,
      maxTimeoutSeconds: input.maxTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      ...(input.extra ? { extra: input.extra } : {}),
    };
    return { x402Version: 2, resource: input.resource, accepts: [requirements] };
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
    return this.#check(payload, requirements);
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    const { network } = requirements;
    const verification = this.#check(payload, requirements);
    if (!verification.isValid || !isEvmExact(payload.payload)) {
      const errorReason = verification.isValid ? 'unsupported_scheme' : verification.invalidReason;
      return { success: false, errorReason, network };
    }
    const { from, nonce } = payload.payload.authorization;
    this.#usedNonces.add(nonceKey(payload.accepted.network, payload.payload));
    const transaction = sha256Hex(`settle:${network}:${from.toLowerCase()}:${nonce.toLowerCase()}`);
    return { success: true, transaction, network, payer: from };
  }

  #check(payload: PaymentPayload, requirements: PaymentRequirements): VerifyResult {
    const invalid = (invalidReason: string): VerifyResult => ({ isValid: false, invalidReason });
    const accepted = payload.accepted;
    if (payload.x402Version !== 2) return invalid('unsupported_x402_version');
    if (!isEvmExact(payload.payload)) return invalid('unsupported_scheme');
    const { authorization, signature } = payload.payload;

    if (
      accepted.scheme !== requirements.scheme ||
      accepted.network !== requirements.network ||
      accepted.asset.toLowerCase() !== requirements.asset.toLowerCase() ||
      accepted.payTo.toLowerCase() !== requirements.payTo.toLowerCase()
    ) {
      return invalid('requirements_mismatch');
    }
    if (!isHex(signature)) return invalid('invalid_signature');
    if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase())
      return invalid('recipient_mismatch');
    if (!INTEGER.test(authorization.value)) return invalid('invalid_amount');
    if (BigInt(authorization.value) < BigInt(requirements.amount))
      return invalid('insufficient_amount');

    const now = BigInt(Math.floor(this.#now() / 1000));
    if (!INTEGER.test(authorization.validAfter) || !INTEGER.test(authorization.validBefore)) {
      return invalid('invalid_validity');
    }
    if (BigInt(authorization.validAfter) > now) return invalid('not_yet_valid');
    if (BigInt(authorization.validBefore) <= now) return invalid('expired');
    if (this.#usedNonces.has(nonceKey(accepted.network, payload.payload))) {
      return invalid('nonce_already_used');
    }

    return { isValid: true, payer: authorization.from };
  }
}

function nonceKey(network: string, payload: EvmExactPayload): string {
  const { from, nonce } = payload.authorization;
  return `${network}:${from.toLowerCase()}:${nonce.toLowerCase()}`;
}
