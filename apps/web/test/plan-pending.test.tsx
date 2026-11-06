// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeResponse } from '@ethglobal/protocol/schemas';

import { PENDING_POLL_MS, PlanView } from '../components/PlanView';
import { Wallets } from '../components/Wallets';

import type * as ApiModule from '../lib/api';

const KEY = `ent:${'a'.repeat(40)}`;
const mocks = vi.hoisted(() => ({
  me: vi.fn<(key: string, refresh?: boolean) => Promise<MeResponse>>(),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      me: mocks.me,
      receipts: () => Promise.resolve([]),
      plans: () => Promise.reject(new mod.ApiError(503, 'internal_error', 'not in this test')),
    },
  };
});

const me = (status: MeResponse['status']): MeResponse => ({
  entitlementKey: KEY,
  kind: 'free',
  status,
  tier: 'orb',
  mbTotal: 1000,
  mbUsed: 0,
  remainingMb: 1000,
  usageAsOf: Date.now(),
  usageSource: 'none',
  expiresAt: Date.now() + 7 * 86_400_000,
  arkivKey: `0x${'ab'.repeat(32)}`,
  ledgerReadAt: Date.now(),
  cached: false,
  degraded: false,
});

const PREPARING = /Your eSIM profile is being prepared/;
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.me.mockReset();
});

const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(PENDING_POLL_MS);
  });

describe('/plan while the eSIM profile is pending ("this page updates by itself")', () => {
  it('re-reads /me (past its cache) every 15 s, skips while the tab is hidden, stops once ready', async () => {
    mocks.me.mockResolvedValue(me('pending-profile'));
    render(<PlanView entitlementKey={KEY} />, { wrapper: Wallets });
    expect(await screen.findByText(PREPARING)).toBeTruthy();
    expect(mocks.me).toHaveBeenCalledTimes(1);

    await tick();
    expect(mocks.me).toHaveBeenCalledTimes(2);
    expect(mocks.me).toHaveBeenLastCalledWith(KEY, true);

    visibility = 'hidden';
    await tick();
    expect(mocks.me).toHaveBeenCalledTimes(2);

    visibility = 'visible';
    mocks.me.mockResolvedValue(me('ready'));
    await tick();
    expect(mocks.me).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(PREPARING)).toBeNull();

    await tick();
    await tick();
    expect(mocks.me).toHaveBeenCalledTimes(3);
  });

  it('a ready plan is read once: no polling', async () => {
    mocks.me.mockResolvedValue(me('ready'));
    render(<PlanView entitlementKey={KEY} />, { wrapper: Wallets });
    await screen.findByText(/Expires in/);
    await tick();
    expect(mocks.me).toHaveBeenCalledTimes(1);
  });
});

it.each([360, 1280])(
  'a cancelled plan offers no install or top-up action at width %s',
  async (width) => {
    vi.stubGlobal('innerWidth', width);
    mocks.me.mockResolvedValue({
      ...me('ready'),
      cancelledAt: Date.now(),
      expiresAt: Date.now() - 1,
    });
    render(<PlanView entitlementKey={KEY} />, { wrapper: Wallets });
    await screen.findByTestId('plan-expiry');
    expect(screen.queryByRole('link', { name: /Add .*USDC|Add .*\$/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Install eSIM' })).toBeNull();
    vi.unstubAllGlobals();
  },
);
