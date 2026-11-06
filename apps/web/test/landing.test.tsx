// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { ClaimPaths } from '../components/ClaimPaths';
import { AppHeader, AppShell, Screen, TabBar } from '../components/Shell';
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
          bundleMb: { orb: 1000, document: 1000, device: 0 },
          remainingClaims: 1214,
          maxClaims: 2000,
          paused: false,
          expiresAt: 2_000_000_000_000,
          network: 'eip155:31337',
        }
      : null,
    paid: {
      stepMb: 100,
      priceUsd6PerStep: '400000',
      validityDays: 7,
      accepts: [],
      sizesMb: [1000],
    },
    gift: { sizesMb: [1000], claimWindowS: 3600 },
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
const CLAIM = /^Prove I.m human → 1\sGB$/;
/** The reading this phone saved at 19:53 IST, before the sponsor's campaign went live. */
const SAVED_AT = Date.UTC(2026, 10, 5, 14, 23);

const hrefs = (links: readonly HTMLElement[]) => links.map((a) => a.getAttribute('href'));

afterEach(async () => {
  mocks.plans.mockReset();
  await del('plans');
});

describe('the landing is the hub', () => {
  it('describes the actual sponsor bundle independently of the paid 1 GB offer', async () => {
    const plans = plansWith(true);
    plans.campaign!.bundleMb.orb = 300;
    plans.campaign!.bundleMb.document = 300;
    mocks.plans.mockResolvedValue(plans);
    render(<ClaimPaths />, { wrapper: Wallets });
    await screen.findByRole('link', { name: /^Prove I.m human → 300\sMB$/ });
    // the BalanceCard carries the sponsor's size; the paid top-up keeps its own
    expect(document.querySelector('#landing-coupon')?.getAttribute('aria-label')).toMatch(
      /300\sMB/,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Land in India. Be online in two minutes.',
    );
    const how = screen.getByRole('region', { name: 'How it works' });
    expect(within(how).getByRole('link', { name: /^Top up/ }).textContent).toMatch(
      /1\sGB for \$4\.00/,
    );
  });
  it('shows the paid price from the current offer apart from the sponsor bundle, and the quick actions', async () => {
    const plans = plansWith(true);
    plans.paid.priceUsd6PerStep = '500000';
    mocks.plans.mockResolvedValue(plans);
    render(<ClaimPaths />, { wrapper: Wallets });
    await screen.findByRole('link', { name: CLAIM });
    const how = screen.getByRole('region', { name: 'How it works' });
    expect(within(how).getByRole('link', { name: /^Top up/ }).textContent).toContain(
      '$5.00 in USDC',
    );
    expect(document.querySelector('#landing-coupon')?.textContent).not.toContain('$5.00');
    const quick = screen.getByRole('list', { name: 'Quick actions' });
    expect(hrefs(within(quick).getAllByRole('link'))).toEqual([
      '/verify',
      '/pay',
      '/card',
      '/sponsor',
    ]);
    expect(screen.getByTestId('preflight')).toBeTruthy();
  });

  it('"Everything else" links every flow, each with one sentence', async () => {
    mocks.plans.mockResolvedValue(plansWith(true));
    render(<ClaimPaths />, { wrapper: Wallets });
    const hub = await screen.findByRole('region', { name: 'Everything else' });
    const links = within(hub).getAllByRole('link');
    expect(hrefs(links).sort()).toEqual(EVERY_FLOW);
    for (const link of links)
      expect(link.querySelector('.list-row__subtitle')?.textContent).toMatch(/^\S.{24,}\.$/);
    expect(within(hub).getByRole('link', { name: /^Buy data\s?1\sGB for \$4\.00 in USDC/ })).toBe(
      links.find((a) => a.getAttribute('href') === '/pay'),
    );
  });

  it('"How it works" walks the three steps to their routes, with the warnings', async () => {
    mocks.plans.mockResolvedValue(plansWith(true));
    render(<ClaimPaths />, { wrapper: Wallets });
    const how = await screen.findByRole('region', { name: 'How it works' });
    const steps = within(how).getAllByRole('link');
    expect(steps.map((a) => a.querySelector('.list-row__title')?.textContent)).toEqual([
      'Verify',
      'Install',
      'Top up',
    ]);
    expect(hrefs(steps)).toEqual(['/verify', '/install', '/pay']);
    const [verify, install, topUp] = steps.map((a) => a.textContent);
    expect(verify).toContain('the code opens only in the browser that claims it');
    expect(install).toMatch(/On this phone, by QR or by hand/);
    expect(install).toContain('carrier-unlocked');
    expect(topUp).toContain('Data stops when the plan expires.');
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
    // the phone header has no room for the language switch: the menu's sheet carries it
    expect(within(dialog).getByRole('group', { name: 'Language' })).toBeTruthy();
    const nav = within(dialog).getByRole('navigation', { name: 'Everything Recharge does' });
    expect(hrefs(within(nav).getAllByRole('link')).sort()).toEqual(EVERY_FLOW);
    // the first link of the first group: organizers come first in DESTINATIONS
    await waitFor(() => expect(document.activeElement?.getAttribute('href')).toBe('/sponsor'));

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

describe('the AppShell (DESIGN.md §4)', () => {
  it('the BottomNav and its More sheet reach every flow; the legacy chrome steps aside inside the shell', async () => {
    render(
      <AppShell nav="home">
        <Screen>
          <AppHeader />
          <p>screen body</p>
          <TabBar active="plan" />
        </Screen>
      </AppShell>,
      { wrapper: Wallets },
    );
    // one TopBar, one BottomNav: the old AppHeader / TabBar inside the shell render nothing
    expect(screen.getAllByRole('button', { name: 'Menu' })).toHaveLength(1);
    const nav = screen.getByRole('navigation', { name: 'Recharge' });
    const tabs = within(nav).getAllByRole('link');
    expect(hrefs(tabs)).toEqual(['/', '/plan', '/pay', '/gift']);
    expect(tabs[0]?.getAttribute('aria-current')).toBe('page');

    const more = within(nav).getByRole('button', { name: 'More' });
    fireEvent.click(more);
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(within(sheet).getByRole('group', { name: 'Language' })).toBeTruthy();
    expect(
      within(sheet).getByRole('switch', { name: 'Show proof after each action' }),
    ).toBeTruthy();
    const rest = hrefs(within(within(sheet).getByRole('navigation')).getAllByRole('link')).sort();
    expect(rest).toEqual(['/agent', '/card', '/gift/claim', '/receipts', '/sponsor', '/verify']);
    expect([...new Set([...rest, ...hrefs(tabs)])].filter((h) => h !== '/').sort()).toEqual(
      EVERY_FLOW,
    );
    fireEvent.keyDown(document.activeElement ?? sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(more));
  });
});

describe('the landing never shows a stored /plans reading as current (stale landing, 5 Nov)', () => {
  const saveReadingWithoutCampaign = () => set('plans', { at: SAVED_AT, plans: plansWith(false) });

  it('online: every load asks GET /plans, and the fresh reading drives the card and the button', async () => {
    await saveReadingWithoutCampaign();
    mocks.plans.mockResolvedValue(plansWith(true));
    const first = render(<ClaimPaths />, { wrapper: Wallets });
    const claim = await screen.findByRole('link', { name: CLAIM });
    expect(claim.getAttribute('href')).toBe('/verify');
    expect(screen.getByText('free · 1,214 of 2,000 left')).toBeTruthy();
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
    const pay = screen.getByRole('link', { name: /^Buy 1\sGB · \$4\.00$/ });
    expect(pay.getAttribute('href')).toBe('/pay');
    // one primary pill: with no sponsor bundle open it sells the 1 GB plan, and the claim pill is gone
    expect(screen.queryByRole('link', { name: /^Prove I.m human →/ })).toBeNull();
    // "right now" is never said of a saved reading
    expect(screen.queryByText(/No sponsor bundle is live right now/)).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect((await screen.findByRole('link', { name: CLAIM })).getAttribute('href')).toBe('/verify');
    expect(screen.queryByText(/as of/)).toBeNull();
    expect(screen.queryByRole('link', { name: /^Buy 1\sGB/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Pay instead' }).getAttribute('href')).toBe('/pay');
    expect(mocks.plans).toHaveBeenCalledTimes(2);
  });

  it('an API error is not a network failure: no saved reading comes back, and the count is omitted', async () => {
    await saveReadingWithoutCampaign();
    mocks.plans.mockRejectedValue(new ApiError(503, 'internal_error', 'degraded'));
    render(<ClaimPaths />, { wrapper: Wallets });
    await screen.findByRole('link', { name: CLAIM });
    expect(screen.queryByText(/as of/)).toBeNull();
    expect(screen.queryByText(/of 2,000 left/)).toBeNull();
    expect(screen.queryByText(/No sponsor bundle is live/)).toBeNull();
  });
});
