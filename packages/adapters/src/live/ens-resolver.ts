/**
 * EnsResolver (T-43): ENSIP-15 normalisation (shared with the mock), then viem getEnsAddress / getEnsText on a
 * mainnet client (Universal Resolver, CCIP-Read). On a transport error the fallback client (Sepolia) answers and the
 * result is logged as `source: fallback`. Un-normalisable input throws invalid_name (400), unresolvable is null (404).
 */
import { getAddress, type Address, type PublicClient } from 'viem';

import { normalizeEnsName } from '../ens-name.js';
import { AdapterError } from '../errors.js';

import type { NameResolver } from '../types.js';

export type EnsClient = Pick<PublicClient, 'getEnsAddress' | 'getEnsText'>;

export interface EnsResolverOptions {
  mainnetClient: EnsClient;
  fallbackClient?: EnsClient;
  logger?: Pick<Console, 'debug' | 'warn'>;
}

export class EnsResolver implements NameResolver {
  constructor(readonly opts: EnsResolverOptions) {}

  async #ask<T>(
    name: string,
    fn: (client: EnsClient, normalized: string) => Promise<T>,
  ): Promise<T> {
    const normalized = normalizeEnsName(name);
    try {
      return await fn(this.opts.mainnetClient, normalized);
    } catch (error) {
      const fallback = this.opts.fallbackClient;
      if (!fallback)
        throw new AdapterError('names', 'unavailable', 'ENS RPC unavailable', {
          reason: (error as Error).name,
        });
      try {
        const result = await fn(fallback, normalized);
        this.opts.logger?.debug?.(
          `ens: ${normalized} answered by the fallback client (source: fallback)`,
        );
        return result;
      } catch {
        throw new AdapterError('names', 'unavailable', 'ENS RPC and fallback unavailable');
      }
    }
  }

  async resolve(name: string): Promise<Address | null> {
    const address = await this.#ask(name, (c, n) => c.getEnsAddress({ name: n }));
    return address ? getAddress(address) : null;
  }

  async getText(name: string, key: string): Promise<string | null> {
    if (!/^[\w.:-]{1,64}$/.test(key))
      throw new AdapterError('names', 'invalid_request', 'bad text record key');
    const text = await this.#ask(name, (c, n) => c.getEnsText({ name: n, key }));
    return text === '' ? null : (text ?? null);
  }
}
