/** Refund input rules shared by MockTreasury, EvmTreasury and HederaTreasury (T-71). */
import { payToMatchesNetwork } from '@ethglobal/protocol/schemas';

import { AdapterError } from './errors.js';

export interface RefundInput {
  network: string;
  to: string;
  usd6: bigint;
  memo: string;
}

/** Hedera's transaction memo limit; we apply it on every network. */
export const MAX_MEMO_BYTES = 100;

export function assertRefund(input: RefundInput): void {
  if (typeof input.usd6 !== 'bigint' || input.usd6 <= 0n) {
    throw new AdapterError('treasury', 'invalid_amount', 'usd6 must be a positive bigint');
  }
  if (!payToMatchesNetwork(input.network, input.to)) {
    throw new AdapterError('treasury', 'invalid_request', 'recipient does not match the network');
  }
  if (new TextEncoder().encode(input.memo).length > MAX_MEMO_BYTES) {
    throw new AdapterError('treasury', 'invalid_request', `memo exceeds ${MAX_MEMO_BYTES} bytes`);
  }
}
