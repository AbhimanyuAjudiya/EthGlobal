// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { ClaimPaths } from '../components/ClaimPaths';
import { AppHeader } from '../components/Shell';
import { Wallets } from '../components/Wallets';
import { ApiError } from '../lib/api';
import { clockIst } from '../lib/format';
import { del, set } from '../lib/store';

import type * as ApiModule from '../lib/api';

const mocks = vi.hoisted(() => ({ plans: vi.fn<() => Promise<PlansResponse>>() }));

vi.mock('../lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return { ...mod, api: { ...mod.api, plans: mocks.plans } };
});

/** GET /plans with a live sponsor campaign, or without one (what a phone saved before the campaign went live). */
function plansWith(campaign: boolean): PlansResponse {
  return {
    mode: 'local',
    campaign: campaign
      ? {
          id: `0x${'3'.repeat(64)}`,
          name: 'Mumbai Welcome',
          sponsor: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          bundleMb: { orb: 300, document: 150, device: 0 },
          remainingClaims: 1214,
          maxClaims: 2000,
          paused: false,
          expiresAt: 2_000_000_000_000,
          network: 'eip155:31337',
        }
      : null,
    paid: { stepMb: 100, priceUsd6PerStep: '400000', validityDays: 7, accepts: [] },
    gift: { sizesMb: [300], claimWindowS: 3600 },
    simulated: { usage: true, personhood: true },
  };
}

/** Every user flow the landing and the header menu must reach. */
const EVERY_FLOW = [
  '/agent',
  '/card',
  '/gift',
  '/gift/claim',
  '/pay',
  '/plan',
  '/receipts',
  '/sponsor',
  '/verify',
];
const CLAIM = /^Prove I.m human → 300\sMB$/;
/** The reading this phone saved at 19:53 IST, before the sponsor's campaign went live. */
const SAVED_AT = Date.UTC(2026, 10, 5, 14, 23);

const hrefs = (links: readonly HTMLElement[]) => links.map((a) => a.getAttribute('href'));

afterEach(async () => {
  mocks.plans.mockReset();
  await del('plans');
});

describe('the landing is the hub', () => {
  it('"Everything Recharge does" links every flow, each with one sentence', async () => {
    mocks.plans.mockResolvedValue(plansWith(true));
    render(<ClaimPaths />, { wrapper: Wallets });
    const hub = await screen.findByRole('region', { name: 'Everything Recharge does' });
    const links = within(hub).getAllByRole('link');
    expect(hrefs(links).sort()).toEqual(EVERY_FLOW);
    for (const link of links)
      expect(link.querySelector('.hub__line')?.textContent).toMatch(/^\S.{24,}\.$/);
    expect(within(hub).getByRole('link', { name: /^Buy data \$0\.40 per 100 MB in USDC/ })).toBe(
      links.find((a) => a.getAttribute('href') === '/pay'),
    );
  });

  it('"How it works" walks the five steps to their routes, with all three install ways and the warnings', async () => {
    mocks.plans.mockResolvedValue(plansWith(true));
    render(<ClaimPaths />, { wrapper: Wallets });
    const how = await screen.findByRole('region', { name: 'How it works' });
    const steps = [...how.querySelectorAll<HTMLElement>('ol.how > li')];
    expect(steps.map((li) => li.querySelector('h3')?.textContent)).toEqual([
      'Verify',
      'Install',
      'Top up',
      'Gift',
      'Agent',
    ]);
    expect(steps.map((li) => hrefs(within(li).getAllByRole('link')))).toEqual([
      ['/verify'],
      ['/install'],
      ['/pay'],
      ['/gift', '/gift/claim'],
      ['/agent'],
    ]);
    const [verify, install, topUp] = steps.map((li) => li.textContent);
    expect(verify).toContain('the activation code opens only in the browser that claims it');
    expect(install).toMatch(/On this phone.*QR code.*SM-DP\+ address/);
    expect(install).toContain('carrier-unlocked');
    expect(topUp).toContain('Data stops when the plan expires.');
    const esim = screen.getByRole('region', { name: 'How the eSIM works' }).textContent;
    expect(esim).toContain('no phone number');
    expect(esim).toContain('keeps your calls and SMS');
    expect(esim).toContain('carrier-unlocked');
  });
});

describe('the header menu', () => {
  it('opens, holds the focus inside, closes on Escape and gives the focus back', async () => {
    render(<AppHeader />, { wrapper: Wallets });
    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(toggle);
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const nav = within(dialog).getByRole('navigation', { name: 'Everything Recharge does' });
    expect(hrefs(within(nav).getAllByRole('link')).sort()).toEqual(EVERY_FLOW);
    await waitFor(() => expect(document.activeElement?.getAttribute('href')).toBe('/verify'));

    const stops = [...dialog.querySelectorAll<HTMLElement>('a[href], button')];
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) throw new Error('the panel has no tab stops');
    for (const target of stops.slice(1, -1)) {
      // inside the panel Tab moves on as usual
      target.focus();
      expect(fireEvent.keyDown(target, { key: 'Tab' })).toBe(true);
    }
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    // focus that got outside the panel is pulled back in by the next Tab
    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});

describe('the landing never shows a stored /plans reading as current (stale landing, 5 Nov)', () => {
  const saveReadingWithoutCampaign = () => set('plans', { at: SAVED_AT, plans: plansWith(false) });

  it('online: every load asks GET /plans, and the fresh reading drives the coupon and the button', async () => {
    await saveReadingWithoutCampaign();
    mocks.plans.mockResolvedValue(plansWith(true));
    const first = render(<ClaimPaths />, { wrapper: Wallets });
    const claim = await screen.findByRole('link', { name: CLAIM });
    expect(claim.getAttribute('href')).toBe('/verify');
    expect(screen.getByText('1,214 of 2,000 sponsor bundles left')).toBeTruthy();
    expect(screen.queryByText(/as of/)).toBeNull();
    expect(screen.queryByText(/No sponsor bundle is live/)).toBeNull();
    first.unmount();
    // coming back to the landing in the same session asks again: no reading is kept past its load
    render(<ClaimPaths />, { wrapper: Wallets });
    await screen.findByRole('link', { name: CLAIM });
    expect(mocks.plans).toHaveBeenCalledTimes(2);
  });

  it('a network failure shows the saved reading as of its time with its button; back online, the fresh one replaces it', async () => {
    await saveReadingWithoutCampaign();
    mocks.plans
      .mockRejectedValueOnce(new ApiError(0, 'network', 'Failed to fetch'))
      .mockResolvedValue(plansWith(true));
    render(<ClaimPaths />, { wrapper: Wallets });
    expect(await screen.findByText(`as of ${clockIst(SAVED_AT)}`)).toBeTruthy();
    const pay = screen.getByRole('link', { name: /^Pay \$1\.20 for 300\sMB$/ });
    expect(pay.getAttribute('href')).toBe('/pay?mb=300');
    // "right now" is never said of a saved reading
    expect(screen.queryByText(/No sponsor bundle is live right now/)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect((await screen.findByRole('link', { name: CLAIM })).getAttribute('href')).toBe('/verify');
    expect(screen.queryByText(/as of/)).toBeNull();
    expect(screen.queryByRole('link', { name: /^Pay \$1\.20/ })).toBeNull();
    expect(mocks.plans).toHaveBeenCalledTimes(2);
  });

  it('an API error is not a network failure: no saved reading comes back, and the count is omitted', async () => {
    await saveReadingWithoutCampaign();
    mocks.plans.mockRejectedValue(new ApiError(503, 'internal_error', 'degraded'));
    render(<ClaimPaths />, { wrapper: Wallets });
    await screen.findByRole('link', { name: CLAIM });
    expect(screen.queryByText(/as of/)).toBeNull();
    expect(screen.queryByText(/sponsor bundles left/)).toBeNull();
    expect(screen.queryByText(/No sponsor bundle is live/)).toBeNull();
  });
});
