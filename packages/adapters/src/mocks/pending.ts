import { AdapterError } from '../errors.js';

import type { AdapterName } from '../types.js';

/**
 * Placeholder for a port whose local mock has not landed yet (MockReseller, MockConsensusLog,
 * MemoryBlobStore, MockTreasury: adapters-live workstream, INTERFACES §3.2). Every method rejects with
 * AdapterError(name, 'not_implemented'); a synchronous method throws it.
 */
export function pendingPort<T extends object>(name: AdapterName): T {
  const fail = (): never => {
    throw new AdapterError(name, 'not_implemented', `${name}: local mock not implemented yet`);
  };
  return new Proxy({} as T, {
    get: (_target, property) => (property === 'then' ? undefined : fail),
  });
}
