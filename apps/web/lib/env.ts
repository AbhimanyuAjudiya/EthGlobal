/**
 * Public configuration (INTERFACES §11 "Web (public)"). Every value is a literal `process.env.NEXT_PUBLIC_*`
 * read so Next inlines it at build time.
 *
 * Local-only code (the demo wallet, the simulated World ID, the e2e hook) is guarded by the LITERAL
 * `process.env.NEXT_PUBLIC_MODE === 'local'` at each call site and lives in lib/local/*, imported only inside
 * such a guard: Next inlines the string, the minifier folds the branch and the module never reaches a live chunk
 * (RT-W-12, T-63). There is deliberately no exported IS_LOCAL constant — a cross-module binding is not folded.
 */

export const config = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, ''),
  anvilRpcUrl: process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? 'http://127.0.0.1:8545',
  worldAppId: process.env.NEXT_PUBLIC_WORLD_APP_ID ?? '',
  worldAction: process.env.NEXT_PUBLIC_WORLD_ACTION ?? 'recharge-welcome',
  worldEnvironment:
    process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT === 'staging' ? 'staging' : 'production',
  /** `https://sepolia.basescan.org` → `${explorerEvm}/tx/<hash>`; empty on Anvil (no public explorer). */
  explorerEvm: process.env.NEXT_PUBLIC_EXPLORER_EVM ?? '',
  explorerHedera: process.env.NEXT_PUBLIC_EXPLORER_HEDERA ?? 'https://hashscan.io/testnet',
  arkivExplorer: process.env.NEXT_PUBLIC_ARKIV_EXPLORER ?? 'https://rabdi.explorer.arkiv.network',
  /** Wednesday's measured median attach time in seconds; empty → the "1–3 min" range is shown. */
  attachMedianS: Number(process.env.NEXT_PUBLIC_ATTACH_MEDIAN_S ?? '') || undefined,
  /** DataDrop for the sponsor's createCampaign; local falls back to deploy/addresses.anvil.json. */
  dataDropAddress: process.env.NEXT_PUBLIC_DATADROP_ADDRESS ?? '',
  /** Chain the sponsor dashboard and EIP-712 Recharge domain use (Anvil 31337 locally). */
  chainId:
    Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '') ||
    (process.env.NEXT_PUBLIC_MODE === 'local' ? 31337 : 84532),
} as const;

/** Explorer URL template for a transaction on `network` (CAIP-2), `{hash}` placeholder; undefined → no link. */
export function explorerTemplate(network: string | undefined): string | undefined {
  if (network?.startsWith('hedera:')) return `${config.explorerHedera}/transaction/{hash}`;
  if (network?.startsWith('eip155:') && config.explorerEvm)
    return `${config.explorerEvm}/tx/{hash}`;
  return undefined;
}

export function explorerName(network: string | undefined): string | undefined {
  if (network?.startsWith('hedera:')) return 'HashScan';
  if (network?.startsWith('eip155:') && config.explorerEvm) return 'Explorer';
  return undefined;
}

/** Network name for travellers — never a chain id (design-references §7 #7). */
export function networkName(network: string | undefined): string {
  if (!network) return 'Unknown network';
  if (network.startsWith('hedera:')) return 'Hedera';
  if (network === 'eip155:84532' || network === 'eip155:8453') return 'Base';
  if (network === 'eip155:31337') return 'Local chain';
  // nosemgrep: recharge-x402-v1-primitive — display label for a receipt's chain, never sent as an x402 network
  if (network === 'eip155:296') return 'Hedera EVM';
  return 'EVM';
}
