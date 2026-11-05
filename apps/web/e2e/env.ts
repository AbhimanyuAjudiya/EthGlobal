import path from 'node:path';

/** The local stack the suite runs against (scripts/e2e-local.sh defaults: Anvil 8546, API 8788, web 3000). */
export const repoRoot = path.join(import.meta.dirname, '../../..');
export const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8788';
export const RPC_URL =
  process.env.PLAYWRIGHT_RPC_URL ?? process.env.RPC_URL ?? 'http://127.0.0.1:8546';
export const WEB_PORT = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3000);
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${WEB_PORT}`;
export const PRINT_TOKEN = process.env.PRINT_TOKEN ?? 'local-e2e-print-token-0001';
export const PRINT_CARDS_FILE =
  process.env.PRINT_CARDS_FILE ?? path.join(repoRoot, '.e2e', 'web-print-cards.json');
/** Cards (serial, pin) and the campaign the global setup created, for the card and print specs. */
export const STATE_FILE =
  process.env.E2E_STATE_FILE ?? path.join(repoRoot, '.e2e', 'web-e2e-state.json');
/** The public Anvil test mnemonic (the demo wallet's server-side source). */
export const ANVIL_MNEMONIC =
  process.env.DEMO_WALLET_MNEMONIC ?? 'test test test test test test test test test test test junk';
export const SCREENSHOTS = path.join(import.meta.dirname, '__screenshots__');
