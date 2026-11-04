/** A complete, safe MODE=live environment for parseEnv/buildDeps tests (no network is touched). */
const key = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(32)}`;
export const LIVE_ENV: Record<string, string> = {
  MODE: 'live',
  RPC_URL: 'https://testnet.hashio.io/api',
  CHAIN: '296',
  OCTROI_SECRET: key(0x21),
  SERVER_SEAL_KEY: key(0x22),
  ATTESTOR_PRIVATE_KEY: key(0x23),
  RELAYER_PRIVATE_KEY: key(0x24),
  TREASURY_PRIVATE_KEY: key(0x25),
  ARKIV_PRIVATE_KEY: key(0x26),
  WORLD_RP_SIGNING_KEY: key(0x27),
  WORLD_RP_ID: 'rp_abc123',
  WORLD_APP_ID: 'app_abc123',
  PAYOUT_ADDRESS: '0x1111111111111111111111111111111111111111',
  X402_NETWORKS: 'eip155:84532',
  X402_FACILITATOR: 'remote',
  RESELLER: 'esimaccess',
  ESIMACCESS_WEBHOOK_TOKEN: 'a-very-long-webhook-token-0123456789',
};
