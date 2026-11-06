// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CampaignByName } from '../components/CampaignByName';
import { Wallets } from '../components/Wallets';

import type * as EnsModule from '../lib/ens';

const POOL = 'eip155:296:0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6';
const ID = `0x${'c0'.repeat(32)}`;
const mocks = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('../lib/ens', async (importOriginal) => {
  const mod = await importOriginal<typeof EnsModule>();
  return {
    ...mod,
    readCampaignName: mocks.read,
    // this build's DataDrop on 296 (NEXT_PUBLIC_* are inlined at build time; pinned here)
    checkCampaignName: (facts: Parameters<typeof mod.checkCampaignName>[0], now: number) =>
      mod.checkCampaignName(facts, now, POOL),
  };
});

const live = BigInt(Math.floor(Date.now() / 1000) + 86_400);
const facts = (texts: Record<string, string>, expiry = live) => ({
  name: 'goa-beach.re-charge.eth',
  texts,
  expiry,
});
const ours = {
  'recharge.campaign': ID,
  'recharge.pool': POOL,
  'recharge.bundle': '1 GB · 7 days',
  description: 'Free data at Goa beach',
};

describe('/c/<slug> — claim by ENS name', () => {
  afterEach(() => vi.clearAllMocks());

  it('a live name of ours: the sponsor branding and "Get 1 GB free" for THAT campaign', async () => {
    mocks.read.mockResolvedValue(facts({ ...ours, 'com.twitter': 'goabeach' }));
    render(<CampaignByName slug="goa-beach" />, { wrapper: Wallets });
    const cta = await screen.findByRole('link', { name: 'Get 1 GB free' });
    expect(cta.getAttribute('href')).toBe(`/verify?campaign=${ID}`);
    expect(screen.getByText('Free data at Goa beach')).toBeTruthy();
    expect(screen.getByRole('link', { name: '@goabeach on X' }).getAttribute('href')).toBe(
      'https://x.com/goabeach',
    );
    expect(mocks.read).toHaveBeenCalledWith('goa-beach');
  });

  it('a name pointing at another pool is refused: "This campaign has ended" + Buy data', async () => {
    mocks.read.mockResolvedValue(
      facts({ ...ours, 'recharge.pool': 'eip155:296:0x000000000000000000000000000000000000dEaD' }),
    );
    render(<CampaignByName slug="goa-beach" />, { wrapper: Wallets });
    expect(await screen.findByText('This campaign has ended.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Buy data' }).getAttribute('href')).toBe('/pay');
    expect(screen.queryByText(/free$/)).toBeNull();
  });

  it('an expired name has ended', async () => {
    mocks.read.mockResolvedValue(facts(ours, BigInt(Math.floor(Date.now() / 1000) - 60)));
    render(<CampaignByName slug="goa-beach" />, { wrapper: Wallets });
    expect(await screen.findByTestId('campaign-ended')).toBeTruthy();
  });

  it('Sepolia not answering is not "ended": it says so and offers a retry', async () => {
    mocks.read.mockRejectedValue(new Error('fetch failed'));
    render(<CampaignByName slug="goa-beach" />, { wrapper: Wallets });
    expect(await screen.findByText(/Could not reach Sepolia/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
