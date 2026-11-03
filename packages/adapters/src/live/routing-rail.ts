/** RoutingPaymentRail: one rail per network (`accepted.network`); an unknown network is unsupported_scheme, never a throw. */
import { AdapterError } from '../errors.js';

import type {
  PaymentPayload,
  PaymentRail,
  PaymentRequired,
  PaymentRequirementInput,
  PaymentRequirements,
  SettleResult,
  VerifyResult,
} from '../types.js';

export class RoutingPaymentRail implements PaymentRail {
  readonly #rails: ReadonlyMap<string, PaymentRail>;

  constructor(rails: Record<string, PaymentRail>) {
    this.#rails = new Map(Object.entries(rails));
  }

  get networks(): string[] {
    return [...this.#rails.keys()];
  }

  createPaymentRequirement(input: PaymentRequirementInput): PaymentRequired {
    const rail = this.#rails.get(input.network);
    if (!rail) throw new AdapterError('payments', 'unsupported_scheme', `no rail for ${input.network}`);
    return rail.createPaymentRequirement(input);
  }

  #route(payload: PaymentPayload, requirements: PaymentRequirements): PaymentRail | undefined {
    const network = payload.accepted?.network;
    return network === requirements.network ? this.#rails.get(network) : undefined;
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
    const rail = this.#route(payload, requirements);
    return rail ? rail.verify(payload, requirements) : { isValid: false, invalidReason: 'unsupported_scheme' };
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    const rail = this.#route(payload, requirements);
    return rail
      ? rail.settle(payload, requirements)
      : { success: false, errorReason: 'unsupported_scheme', network: requirements.network, transaction: '' };
  }
}
