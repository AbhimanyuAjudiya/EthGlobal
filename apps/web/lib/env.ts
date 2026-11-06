/**
 * Public configuration (INTERFACES §11 "Web (public)"). Every value is a literal `process.env.NEXT_PUBLIC_*`
 * read so Next inlines it at build time.
 *
 * Local-only code (the demo wallet, the simulated World ID, the e2e hook) is guarded by the LITERAL
 * `process.env.NEXT_PUBLIC_MODE === 'local'` at each call site and lives in lib/local/*, imported only inside
 * such a guard: Next inlines the string, the minifier folds the branch and the module never reaches a live chunk
 * (RT-W-12, T-63). There is deliberately no exported IS_LOCAL constant — a cross-module binding is not folded.
 */

/** Chain the sponsor dashboard and EIP-712 Recharge domain use (Anvil 31337 locally). */
const chainId =
  Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '') ||
  (process.env.NEXT_PUBLIC_MODE === 'local' ? 31337 : 84532);

/**
 * 31337 (Anvil), 84532 (Base Sepolia) and 296 (Hedera testnet) are testnets; 295 (Hedera) and 8453 (Base) are mainnets.
 * An unknown chain id counts as a testnet, so the TESTNET strip stays up until the chain is named (fail-safe). This is
 * a runtime gate, not a compile-out like MODE=local: the strip's copy stays in the i18n tables of every build.
 */
export const IS_TESTNET = chainId !== 295 && chainId !== 8453;

export const config = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, ''),
  anvilRpcUrl: process.env.NEXT_PUBLIC_ANVIL_RPC_URL ?? 'http://127.0.0.1:8545',
  worldAppId: process.env.NEXT_PUBLIC_WORLD_APP_ID ?? '',
  worldAction: process.env.NEXT_PUBLIC_WORLD_ACTION ?? 'recharge-welcome',
  worldEnvironment:
    process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT === 'staging' ? 'staging' : 'production',
  /** `${explorerEvm}/tx/<hash>`: Basescan for the Base chain ids, empty on Anvil (no public explorer). */
  // `||`, not `??`: an empty NEXT_PUBLIC_EXPLORER_* (the line .env.example ships) is unset, so the chain-keyed default applies.
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  explorerEvm:
    process.env.NEXT_PUBLIC_EXPLORER_EVM ||
    (chainId === 8453
      ? 'https://basescan.org'
      : chainId === 84532
        ? 'https://sepolia.basescan.org'
        : ''),
  explorerHedera:
    process.env.NEXT_PUBLIC_EXPLORER_HEDERA ||
    `https://hashscan.io/${IS_TESTNET ? 'testnet' : 'mainnet'}`,
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  arkivExplorer: process.env.NEXT_PUBLIC_ARKIV_EXPLORER ?? 'https://rabdi.explorer.arkiv.network',
  /** The Arkiv node /agent reads the agent's receipts from, straight from the browser (lib/arkiv-read.ts). */
  arkivRpc:
    process.env.NEXT_PUBLIC_ARKIV_RPC ?? 'https://rpc.rabdi.db-chain.testnet.arkiv.network/',
  /** The API's Arkiv writer: those reads keep only entities it created (`$creator`, T-79). */
  arkivWriter: process.env.NEXT_PUBLIC_ARKIV_WRITER ?? '0xC3358be9F35fDF5C8e1922be7376980C93734d3c',
  /** Wednesday's measured median attach time in seconds; empty → the "1–3 min" range is shown. */
  attachMedianS: Number(process.env.NEXT_PUBLIC_ATTACH_MEDIAN_S ?? '') || undefined,
  /** DataDrop for the sponsor's createCampaign; in MODE=local next.config.ts fills it from deploy/addresses.anvil.json. */
  dataDropAddress: process.env.NEXT_PUBLIC_DATADROP_ADDRESS ?? '',
  chainId,
} as const;

/** Hedera and Hedera's EVM (295 / 296, where DataDrop lives): HashScan, which takes `0.0.x@s.n` ids and 0x hashes alike. */
const onHashScan = (network: string | undefined): boolean =>
  Boolean(network?.startsWith('hedera:')) || network === 'eip155:295' || network === 'eip155:296';

const BASESCAN: Readonly<Record<string, string>> = {
  'eip155:8453': 'https://basescan.org',
  'eip155:84532': 'https://sepolia.basescan.org',
};

/**
 * An EVM transaction's explorer by its own network: the configured one (NEXT_PUBLIC_EXPLORER_EVM) for the app's chain,
 * BaseScan for Base — the x402 rail, whatever chain the app signs its domain on (296 live) — else none (Anvil).
 */
function evmExplorer(network: string | undefined): string {
  if (network === `eip155:${chainId}` && config.explorerEvm) return config.explorerEvm;
  return (network && BASESCAN[network]) ?? '';
}

/** Explorer URL template for a transaction on `network` (CAIP-2), `{hash}` placeholder; undefined → no link. */
export function explorerTemplate(network: string | undefined): string | undefined {
  if (onHashScan(network)) return `${config.explorerHedera}/transaction/{hash}`;
  const evm = evmExplorer(network);
  return evm ? `${evm}/tx/{hash}` : undefined;
}

export function explorerName(network: string | undefined): string | undefined {
  if (onHashScan(network)) return 'HashScan';
  if (network && BASESCAN[network]) return 'BaseScan';
  return evmExplorer(network) ? 'Explorer' : undefined;
}

/** A contract's explorer page (the sponsor's DataDrop); undefined → no link (local chain). */
export function contractUrl(network: string | undefined, address: string): string | undefined {
  if (onHashScan(network)) return `${config.explorerHedera}/contract/${address}`;
  const evm = evmExplorer(network);
  return evm ? `${evm}/address/${address}` : undefined;
}

/** An Arkiv entity's explorer page; only a real entity key (0x + 64 hex) has one — not a local ledger or logical key. */
export const arkivEntityUrl = (key: string): string | undefined =>
  /^0x[0-9a-fA-F]{64}$/.test(key) ? `${config.arkivExplorer}/entity/${key}` : undefined;

/** The HCS topic a receipt was logged to, on HashScan (`0.0.x`). */
export const hcsTopicUrl = (topic: string): string => `${config.explorerHedera}/topic/${topic}`;

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
