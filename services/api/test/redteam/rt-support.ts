/** Shared red-team helpers (not a test file): the throwaway Anvil (test/support/anvil.ts) and a fake live env. */
import { LIVE_ENV } from '../support/live-env.js';

export { abiOf, anvilReady, startChain, type Chain } from '../support/anvil.js';

/** A complete MODE=live env for an in-process boot over a fake fetch (no network is touched). */
export const fakeLiveEnv = (extra: Record<string, string> = {}): Record<string, string> =>
  Object.assign(
    {},
    LIVE_ENV,
    Object.fromEntries([
      ['CHAIN', '84532'],
      ['RPC_URL', 'https://sepolia.base.org'],
      ['DATADROP_ADDRESS', '0x90193C961A926261B756D1E5bb255e67ff9498A1'],
      ['HEDERA_ACCOUNT_ID', '0.0.5005'],
      ['HEDERA_PRIVATE_KEY', `0x${'31'.repeat(32)}`],
      ['HCS_TOPIC_ID', '0.0.6006'],
      ['ENS_RPC_URL', 'https://eth.example'],
      ['ESIMACCESS_ACCESS_CODE', 'access-code-0123456789'],
      ['RESELLER_FALLBACK', 'none'],
    ]),
    extra,
  );
