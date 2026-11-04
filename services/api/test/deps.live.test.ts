/** MODE=live boots with createLiveAdapters from a fake env (no network is touched at construction) and refuses Anvil keys. */
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { buildDeps } from '../src/deps.js';
import { anvilKey } from '../src/env.js';
import { createLogger } from '../src/logger.js';
import { LIVE_ENV } from './support/live-env.js';

const FAKE_LIVE = {
  ...LIVE_ENV,
  CHAIN: '84532',
  RPC_URL: 'https://sepolia.base.org',
  DATADROP_ADDRESS: '0x90193C961A926261B756D1E5bb255e67ff9498A1',
  HEDERA_ACCOUNT_ID: '0.0.5005',
  HEDERA_PRIVATE_KEY: `0x${'31'.repeat(32)}`,
  HCS_TOPIC_ID: '0.0.6006',
  ENS_RPC_URL: 'https://eth.example',
  ESIMACCESS_ACCESS_CODE: 'access-code-0123456789',
  RESELLER_FALLBACK: 'none',
};

describe('buildDeps (MODE=live)', () => {
  it('wires createLiveAdapters without any network call and serves only testnet terms', async () => {
    const fetch = vi.fn(async () => Response.json({}));
    const deps = await buildDeps(FAKE_LIVE, {
      fetch: fetch as unknown as typeof globalThis.fetch,
      logger: createLogger('silent'),
    });
    expect(deps.adapters.mode).toBe('live');
    expect(deps.adapters.reseller.name).toBe('esimaccess');
    expect(deps.accepts.map((a) => a.network)).toEqual(['eip155:84532']);
    expect(deps.accepts[0]?.extra).toEqual({ name: 'USDC', version: '2' });
    expect(fetch).not.toHaveBeenCalled();
    const app = createApp(deps);
    expect((await app.request('/__local/clock', { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await app.request('/facilitator/supported')).status).toBe(404);
  });

  it('refuses an Anvil attestor key in live', async () => {
    await expect(buildDeps({ ...FAKE_LIVE, ATTESTOR_PRIVATE_KEY: anvilKey(2) })).rejects.toThrow(
      /ATTESTOR_PRIVATE_KEY/,
    );
  });
});
