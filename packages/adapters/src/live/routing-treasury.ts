/** RoutingTreasury: one treasury per network; an unknown network is unsupported_network — never a default rail (L14). */
import { AdapterError } from '../errors.js';

import type { RefundInput } from '../treasury-rules.js';
import type { Treasury } from '../types.js';

export class RoutingTreasury implements Treasury {
  readonly #byNetwork: ReadonlyMap<string, Treasury>;

  constructor(byNetwork: Record<string, Treasury>) {
    this.#byNetwork = new Map(Object.entries(byNetwork));
  }

  #for(network: string): Treasury {
    const t = this.#byNetwork.get(network);
    if (!t) throw new AdapterError('treasury', 'unsupported_network', `no treasury for ${network}`);
    return t;
  }

  async refund(input: RefundInput): Promise<{ tx: string }> {
    return this.#for(input.network).refund(input);
  }

  async balanceUsd6(network: string): Promise<bigint> {
    return this.#for(network).balanceUsd6(network);
  }
}
