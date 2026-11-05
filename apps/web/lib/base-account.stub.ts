/**
 * Stand-in for `@base-org/account` (next.config.ts resolveAlias). wagmi's baseAccount connector imports it lazily;
 * RainbowKit's index re-exports that connector, so Turbopack would bundle the Base Account SDK and its CDP SDK (which
 * imports @x402/evm and @x402/svm, not installed here). lib/wagmi.ts lists no Base Account wallet, so this never runs.
 */
export function createBaseAccountSDK(): never {
  throw new Error('Base Account is not offered by this app');
}
