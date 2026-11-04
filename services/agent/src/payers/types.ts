/** The signer abstraction (INTERFACES §8): a Payer is a PaymentSigner for one network that knows its balance. */
import type { PaymentRequirements } from '@ethglobal/protocol/schemas';
import type { PaymentSigner } from '@ethglobal/protocol/x402';

export interface Payer extends PaymentSigner {
  readonly network: string;
  balanceUsd6(): Promise<bigint>;
  /** Why this payer would not take `req` (undefined = acceptable). `choose` returns the first acceptable entry. */
  refusal(req: PaymentRequirements): string | undefined;
}

export type RefusalReason = 'insufficient-balance' | 'domain-mismatch' | 'payload-mismatch';

/** Thrown from `sign()` before any signature exists; the buyer turns it into `agent.skip { reason }`. */
export class PayerRefusal extends Error {
  override readonly name = 'PayerRefusal';

  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super(message);
  }
}

/** Pick the first entry `refusal()` accepts; never "the first entry" blindly (T-56). */
export function chooseFirstAcceptable(
  payer: Pick<Payer, 'refusal'>,
  accepts: PaymentRequirements[],
): PaymentRequirements | undefined {
  return accepts.find((req) => payer.refusal(req) === undefined);
}
