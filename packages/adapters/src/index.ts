import { MockInference, type MockInferenceOptions } from './mocks/inference.js';
import { InMemoryLedger } from './mocks/ledger.js';
import { MockNameResolver, type NameRecord } from './mocks/name-resolver.js';
import { MockPaymentRail } from './mocks/payment-rail.js';
import { MockPersonhood } from './mocks/personhood.js';
import { MockReseller } from './mocks/reseller.js';
import { MockConsensusLog } from './mocks/consensus-log.js';
import { MemoryBlobStore } from './mocks/blob-store.js';
import { MockTreasury } from './mocks/treasury.js';
import { adapterModes, type AdapterMode, type Adapters, type EsimPlan } from './types.js';

export * from './types.js';
export { AdapterError, ADAPTER_ERROR_CODES, isAdapterError, type AdapterErrorCode } from './errors.js';
export { sha256Hex, isHex } from './hash.js';
export * from './x402-headers.js';
export { nullifierHex, signalHash } from './personhood-proof.js';
export { normalizeEnsName } from './ens-name.js';
export { MAX_LEDGER_EXPIRES_IN_S } from './ledger-rules.js';
export { InMemoryLedger, type InMemoryLedgerOptions } from './mocks/ledger.js';
export { MockPersonhood, type MockPersonhoodOptions } from './mocks/personhood.js';
export { MockPaymentRail, type MockPaymentRailOptions } from './mocks/payment-rail.js';
export { MockInference, type MockInferenceOptions } from './mocks/inference.js';
export {
  MockReseller,
  MOCK_PLANS,
  DEFAULT_MOCK_WEBHOOK_SECRET,
  type MockResellerOptions,
} from './mocks/reseller.js';
export { MockConsensusLog, type MockConsensusLogOptions } from './mocks/consensus-log.js';
export { MemoryBlobStore } from './mocks/blob-store.js';
export { MockTreasury, type MockTreasuryOptions } from './mocks/treasury.js';
export {
  MockNameResolver,
  anvilAccounts,
  defaultNameRecords,
  normalizeName,
  type NameRecord,
} from './mocks/name-resolver.js';

export interface LocalAdapterOptions {
  /** Shared clock for ledger expiry, payment windows, reseller usage and consensus timestamps. */
  now?: () => number;
  names?: readonly NameRecord[];
  inference?: MockInferenceOptions;
  reseller?: {
    usageMbPerMinute?: number;
    plans?: EsimPlan[];
    webhookSecret?: Uint8Array;
    failNextOrder?: boolean;
  };
  personhood?: { expectSignal?: boolean };
}

/** Parses MODE from the environment; unset or empty means local. */
export function parseAdapterMode(value: string | undefined): AdapterMode {
  if (value === undefined || value === '') return 'local';
  if ((adapterModes as readonly string[]).includes(value)) return value as AdapterMode;
  throw new Error(`MODE must be one of ${adapterModes.join(', ')}; got "${value}"`);
}

/**
 * The local bundle: deterministic in-memory mocks, no network. `live` is built by `createLiveAdapters` from
 * '@ethglobal/adapters/live' (Node only, so this browser-safe barrel never imports it).
 */
export function createAdapters(mode: AdapterMode, options: LocalAdapterOptions = {}): Adapters {
  if (mode === 'live') {
    throw new Error(
      "createAdapters('live') is not supported here; use createLiveAdapters(liveConfigSchema.parse(process.env)) from '@ethglobal/adapters/live'",
    );
  }
  const now = options.now ?? Date.now;
  return {
    mode,
    ledger: new InMemoryLedger({ now }),
    personhood: new MockPersonhood(options.personhood ?? {}),
    payments: new MockPaymentRail({ now }),
    inference: new MockInference(options.inference ?? {}),
    names: new MockNameResolver(options.names ?? undefined),
    reseller: new MockReseller({ now, ...options.reseller }),
    consensus: new MockConsensusLog({ now }),
    blobs: new MemoryBlobStore(),
    treasury: new MockTreasury(),
  };
}
