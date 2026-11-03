import { MockInference, type MockInferenceOptions } from './mocks/inference.js';
import { InMemoryLedger } from './mocks/ledger.js';
import { MockNameResolver, type NameRecord } from './mocks/name-resolver.js';
import { MockPaymentRail } from './mocks/payment-rail.js';
import { MockPersonhood } from './mocks/personhood.js';
import { adapterModes, type AdapterMode, type Adapters } from './types.js';

export * from './types.js';
export { AdapterError } from './errors.js';
export { sha256Hex, isHex } from './hash.js';
export * from './x402-headers.js';
export { InMemoryLedger, type InMemoryLedgerOptions } from './mocks/ledger.js';
export { MockPersonhood } from './mocks/personhood.js';
export { MockPaymentRail, type MockPaymentRailOptions } from './mocks/payment-rail.js';
export { MockInference, type MockInferenceOptions } from './mocks/inference.js';
export {
  MockNameResolver,
  anvilAccounts,
  defaultNameRecords,
  normalizeName,
  type NameRecord,
} from './mocks/name-resolver.js';

export interface LocalAdapterOptions {
  /** Shared clock for ledger expiry and payment validity windows. */
  now?: () => number;
  names?: readonly NameRecord[];
  inference?: MockInferenceOptions;
}

/** Parses MODE from the environment; unset or empty means local. */
export function parseAdapterMode(value: string | undefined): AdapterMode {
  if (value === undefined || value === '') return 'local';
  if ((adapterModes as readonly string[]).includes(value)) return value as AdapterMode;
  throw new Error(`MODE must be one of ${adapterModes.join(', ')}; got "${value}"`);
}

/**
 * Builds the adapter bundle for a mode. `local` returns deterministic in-memory mocks with no network
 * access. `live` is wired after the product decision and currently throws.
 */
export function createAdapters(mode: AdapterMode, options: LocalAdapterOptions = {}): Adapters {
  if (mode === 'live') {
    throw new Error('createAdapters("live") is not implemented yet; run with MODE=local');
  }
  const now = options.now ?? Date.now;
  return {
    mode,
    ledger: new InMemoryLedger({ now }),
    personhood: new MockPersonhood(),
    payments: new MockPaymentRail({ now }),
    inference: new MockInference(options.inference ?? {}),
    names: new MockNameResolver(options.names ?? undefined),
  };
}
