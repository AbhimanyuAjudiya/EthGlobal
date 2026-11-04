/** T-52, T-69, T-85, AP16: MODE=live refuses to boot on every unsafe combination, naming the variable. */
import { describe, expect, it } from 'vitest';

import { anvilKey, parseEnv } from '../../src/env.js';
import { LIVE_ENV } from '../support/live-env.js';

describe('T-52 env guards (live)', () => {
  it('boots with a complete live environment', () => {
    expect(parseEnv(LIVE_ENV)).toMatchObject({ MODE: 'live', CHAIN: 296 });
  });

  it.each([
    ['ATTESTOR_PRIVATE_KEY', anvilKey(2)],
    ['RELAYER_PRIVATE_KEY', anvilKey(6)],
    ['ARKIV_PRIVATE_KEY', anvilKey(0)],
    ['TREASURY_PRIVATE_KEY', anvilKey(8)],
    ['OCTROI_SECRET', `0x${'07'.repeat(32)}`],
    ['OCTROI_SECRET', `0x${'07'.repeat(16)}`],
    ['LOG_LEVEL', 'debug'],
    ['LOG_LEVEL', 'trace'],
    ['X402_NETWORKS', 'eip155:8453'],
    ['ARKIV_CHAIN_ID', '60138453025'],
    ['RESELLER', 'megaesim'],
    ['X402_FACILITATOR', 'mock'],
    ['WORLD_ENVIRONMENT', 'staging'],
    ['WORLD_RP_ID', ''],
    ['WORLD_RP_SIGNING_KEY', ''],
    ['WORLD_APP_ID', ''],
    ['RPC_URL', ''],
    ['ESIMACCESS_WEBHOOK_TOKEN', ''],
  ])('refuses %s=%s', (name, value) => {
    expect(() => parseEnv({ ...LIVE_ENV, [name]: value })).toThrow(new RegExp(name));
  });

  it.each(['SEED_CARDS', 'SEED_VALIDITY_S', 'seed_anything'])(
    'refuses any %s flag (T-85)',
    (name) => {
      expect(() => parseEnv({ ...LIVE_ENV, [name]: '1' })).toThrow(/seed hooks are local-only/);
    },
  );

  it('allows a mainnet network only with both sales flags (T-69)', () => {
    expect(() =>
      parseEnv({ ...LIVE_ENV, X402_NETWORKS: 'eip155:8453', SALES_ENABLED: 'true' }),
    ).toThrow(/X402_NETWORKS/);
    expect(
      parseEnv({
        ...LIVE_ENV,
        X402_NETWORKS: 'eip155:8453',
        SALES_ENABLED: 'true',
        LEGAL_MEMO_OK: 'true',
      }).X402_NETWORKS,
    ).toEqual(['eip155:8453']);
  });
});
