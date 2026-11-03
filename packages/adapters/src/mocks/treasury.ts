import { sha256Hex } from '@ethglobal/crypto';
import { NETWORKS } from '@ethglobal/protocol/ids';

import { AdapterError } from '../errors.js';
import { assertRefund, type RefundInput } from '../treasury-rules.js';

import type { Treasury } from '../types.js';

export interface MockTreasuryOptions {
  /** Float per network (base units); default $1,000 on each testnet network. */
  balances?: Record<string, bigint>;
}

/** Deterministic refund wallet: tx = sha256Hex('refund:…'), balances decrease, `failNext` fails exactly one call. */
export class MockTreasury implements Treasury {
  readonly #balances: Map<string, bigint>;
  readonly #refunds: (RefundInput & { tx: string })[] = [];
  /** When true, the next refund throws AdapterError('treasury', 'unavailable') and the switch resets. */
  failNext = false;

  constructor(options: MockTreasuryOptions = {}) {
    const balances = options.balances ?? Object.fromEntries(Object.values(NETWORKS).map((n) => [n, 1_000_000_000n]));
    this.#balances = new Map(Object.entries(balances));
  }

  async refund(input: RefundInput): Promise<{ tx: string }> {
    assertRefund(input);
    const balance = this.#balance(input.network);
    if (this.failNext) {
      this.failNext = false;
      throw new AdapterError('treasury', 'unavailable', 'mock treasury: simulated failure');
    }
    if (balance < input.usd6) {
      throw new AdapterError('treasury', 'unavailable', 'treasury float exhausted', { reason: 'insufficient_float' });
    }
    this.#balances.set(input.network, balance - input.usd6);
    const tx = sha256Hex(
      `refund:${input.network}:${input.to.toLowerCase()}:${input.usd6}:${input.memo}:${this.#refunds.length + 1}`,
    );
    this.#refunds.push({ ...input, tx });
    return { tx };
  }

  async balanceUsd6(network: string): Promise<bigint> {
    return this.#balance(network);
  }

  refunds(): readonly { network: string; to: string; usd6: bigint; memo: string; tx: string }[] {
    return this.#refunds.map((r) => ({ ...r }));
  }

  #balance(network: string): bigint {
    const balance = this.#balances.get(network);
    if (balance === undefined) {
      throw new AdapterError('treasury', 'unsupported_network', `no treasury for ${network}`);
    }
    return balance;
  }
}
