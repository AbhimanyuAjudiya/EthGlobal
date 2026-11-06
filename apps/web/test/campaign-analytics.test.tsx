// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SponsorAnalytics } from '@ethglobal/protocol/schemas';

import { analyticsCsv, CampaignAnalytics, SOON_MS } from '../components/CampaignAnalytics';
import { LangProvider } from '../i18n/lang';
import { ApiError, call } from '../lib/api';

import type * as ApiModule from '../lib/api';

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  call: vi.fn(),
}));

const H = 3_600_000;
const DAY = 24 * H;
/** 12:00 IST, Fri 6 Nov 2026. */
const NOW = Date.UTC(2026, 10, 6, 6, 30);
const ID = `0x${'ab'.repeat(32)}`;
const LOGIN = { sponsor: `0x${'11'.repeat(20)}`, issuedAt: NOW, signature: '0x1234' };
const tx = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(32)}`;
const arkiv = (n: number) => `0x${n.toString(16).padStart(64, 'e')}`;

const row = (
  n: number,
  over: Partial<SponsorAnalytics['notInstalled']['rows'][number]> = {},
): SponsorAnalytics['notInstalled']['rows'][number] => ({
  claimedAt: NOW - 2 * H,
  tier: 'document',
  status: 'pending-profile',
  ageHours: 2,
  expiresAt: NOW + 7 * DAY - 2 * H,
  claimTx: tx(n),
  arkivKey: arkiv(n),
  ...over,
});

const fixture = (over: Partial<SponsorAnalytics> = {}): SponsorAnalytics => ({
  campaignId: ID,
  network: 'eip155:296',
  asOf: NOW,
  scannedAt: NOW,
  sampled: false,
  scanCap: 500,
  totals: {
    claims: 4,
    uniqueHumans: 4,
    byTier: { orb: 3, document: 1, unknown: 0 },
    mbDelivered: 4300,
    mbUsed: 50,
    avgMbUsed: 13,
  },
  money: {
    budgetUsd6: '12000000',
    spentUsd6: '4800000',
    remainingUsd6: '7200000',
    pricePerClaimUsd6: '1200000',
    remainingClaims: 6,
    burnPerHour: 0.17,
    runOutAt: NOW + 36 * H,
    endsAt: NOW + 5 * DAY,
    daysLeft: 5,
  },
  daily: Array.from({ length: 14 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 24 + i)).toISOString().slice(0, 10),
    start: Date.UTC(2026, 9, 24 + i) - 19_800_000,
    claims: i === 13 ? 4 : 0,
  })),
  hourly: Array.from({ length: 48 }, (_, i) => ({
    at: Math.floor(NOW / H) * H - (47 - i) * H,
    claims: i >= 44 ? 1 : 0,
  })),
  hourlyCap: 10,
  funnel: {
    claimed: 4,
    installed: 2,
    active: 1,
    toppedUp: 1,
    notInstalled: 2,
    installedRate: 0.5,
    activeRate: 0.25,
    toppedUpRate: 0.25,
    notInstalledRate: 0.5,
    topUps: 1,
    topUpRevenueUsd6: '4000000',
  },
  status: { pending: 1, ready: 1, installed: 1, active: 1, expired: 0 },
  notInstalled: {
    count: 2,
    usd6: '2400000',
    rows: [
      // claimed 6 days ago, lapses in 24 h: flagged
      row(1, {
        claimedAt: NOW - 6 * DAY,
        tier: 'orb',
        status: 'ready',
        statusAsOf: NOW - H,
        ageHours: 144,
        expiresAt: NOW + DAY,
      }),
      row(2),
    ],
  },
  proof: { onChainClaims: 4, claimTxs: 4, arkivReceipts: 4, arkivPlans: 4, hcsMessages: 4 },
  latest: [
    { at: NOW - H, tier: 'orb', tx: tx(3), arkivKey: arkiv(3) },
    { at: NOW - 2 * H, tier: 'document', tx: tx(4), arkivKey: arkiv(4) },
  ],
  ...over,
});

const answer = (data: SponsorAnalytics) =>
  vi.mocked(call).mockResolvedValue({ status: 200, headers: new Headers(), data });
const show = async (data = fixture()) => {
  answer(data);
  render(<CampaignAnalytics id={ID} login={LOGIN} />);
  return screen.findByTestId('campaign-analytics');
};
/** The value under a KPI tile's label. */
const tile = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';

beforeEach(() => vi.mocked(call).mockReset());
afterEach(() => vi.useRealTimers());

describe('CampaignAnalytics', () => {
  it('asks GET /sponsor/:id/analytics with the page’s SponsorLogin; KPI tiles, charts, funnel and status', async () => {
    const section = await show();
    const [path, opts] = vi.mocked(call).mock.calls[0] ?? [];
    expect(path).toBe(`/sponsor/${ID}/analytics`);
    expect(opts?.headers?.authorization).toMatch(/^Recharge-Sponsor /);
    expect(tile('Claims')).toContain('4');
    expect(tile('Claims')).toContain('Orb 3 · Document 1');
    expect(tile('Data delivered')).toContain('4.3');
    expect(tile('Activation')).toContain('50%');
    expect(tile('Spent')).toContain('$4.80');
    expect(tile('Claims left in the budget')).toContain('6');
    expect(tile('Projected run-out')).toContain('0.17 claims/h · campaign ends in 5 d');
    expect(section.querySelectorAll('svg rect.chart__bar')).toHaveLength(14);
    expect(section.querySelector('line.chart__cap')).not.toBeNull();
    const notInstalledStage = section.querySelector('[data-stage="notInstalled"]');
    expect(notInstalledStage?.textContent).toContain('2 · 50%');
    expect(screen.getByText('Paid top-ups by your claimers: 1 · $4.00')).toBeTruthy();
    expect(section.querySelector('.analytics-status')?.getAttribute('aria-label')).toContain(
      'Not installed: 1 preparing, 1 ready: 2',
    );
  });

  it('tracks every eSIM claimed but not installed: headline, oldest first, the 48 h warning, proofs', async () => {
    await show();
    expect(screen.getByTestId('not-installed-headline').textContent).toBe(
      '2 eSIMs claimed but not installed · $2.40',
    );
    const rows = within(screen.getByTestId('not-installed')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const [soon, later] = rows;
    // flagged: expires within 48 h
    expect(soon?.hasAttribute('data-soon')).toBe(true);
    expect(soon?.textContent).toContain('Ready');
    expect(soon?.textContent).toContain('144 h');
    expect(soon?.textContent).toMatch(/expires unused on Sat 7 Nov 12:00/);
    expect(soon?.textContent).toMatch(/as of Fri 6 Nov 11:00/);
    expect(soon?.querySelector('.analytics-expiry .ui-icon')).not.toBeNull();
    // not flagged: a week left
    expect(later?.hasAttribute('data-soon')).toBe(false);
    expect(later?.textContent).toContain('Preparing');
    expect(later?.textContent).toContain('Document');
    expect(later?.querySelector('.analytics-expiry .ui-icon')).toBeNull();
    expect(rows.every((r) => r.querySelectorAll('.hash').length === 2)).toBe(true);
    // the latest claims, with their proof counters
    expect(within(screen.getByTestId('latest-claims')).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText(/^On-chain claims/).textContent).toBe('On-chain claims · 4');
    cleanup();

    // the boundary: exactly 48 h left is flagged, a minute more is not
    await show(
      fixture({
        notInstalled: {
          count: 2,
          usd6: '2400000',
          rows: [
            row(8, { expiresAt: NOW + SOON_MS }),
            row(9, { expiresAt: NOW + SOON_MS + 60_000 }),
          ],
        },
      }),
    );
    const [edge, past] = within(screen.getByTestId('not-installed')).getAllByRole('row').slice(1);
    expect(SOON_MS).toBe(48 * H);
    expect(edge?.hasAttribute('data-soon')).toBe(true);
    expect(past?.hasAttribute('data-soon')).toBe(false);
  });

  it('zero, one and many not-installed rows', async () => {
    await show(fixture({ notInstalled: { count: 0, usd6: '0', rows: [] } }));
    expect(screen.getByText('Every claimed eSIM is installed.')).toBeTruthy();
    expect(screen.queryByTestId('not-installed')).toBeNull();
    cleanup();

    await show(fixture({ notInstalled: { count: 1, usd6: '1200000', rows: [row(5)] } }));
    expect(screen.getByTestId('not-installed-headline').textContent).toBe(
      '1 eSIM claimed but not installed · $1.20',
    );
    expect(within(screen.getByTestId('not-installed')).getAllByRole('row')).toHaveLength(2);
    expect(screen.queryByText(/The oldest/)).toBeNull();
    cleanup();

    await show(
      fixture({ notInstalled: { count: 150, usd6: '180000000', rows: [row(6), row(7)] } }),
    );
    expect(screen.getByText('The oldest 2 of 150')).toBeTruthy();
  });

  it('an empty campaign: the money tiles and one line, no charts or tables', async () => {
    const section = await show(
      fixture({
        totals: {
          claims: 0,
          uniqueHumans: 0,
          byTier: { orb: 0, document: 0, unknown: 0 },
          mbDelivered: 0,
          mbUsed: 0,
          avgMbUsed: 0,
        },
        money: { ...fixture().money, runOutAt: null, burnPerHour: 0 },
      }),
    );
    expect(screen.getByText(/No claims yet/)).toBeTruthy();
    expect(tile('Projected run-out')).toContain('No claims in 24 h');
    expect(section.querySelector('svg')).toBeNull();
    expect(section.querySelector('table')).toBeNull();
  });

  it('loading, then an API error with a retry; nothing at all without a login', async () => {
    vi.mocked(call).mockRejectedValue(
      new ApiError(401, 'unauthorized', 'issuedAt outside the login window'),
    );
    const { unmount } = render(<CampaignAnalytics id={ID} login={LOGIN} />);
    expect(screen.getByText('Loading the analytics…')).toBeTruthy();
    expect(
      await screen.findByText(
        'Could not load the analytics: unauthorized: issuedAt outside the login window',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(vi.mocked(call)).toHaveBeenCalledTimes(2);
    unmount();
    vi.mocked(call).mockReset();
    const { container } = render(<CampaignAnalytics id={ID} login={undefined} />);
    expect(container.innerHTML).toBe('');
    expect(vi.mocked(call)).not.toHaveBeenCalled();
  });

  it('refreshes every 60 s while the tab is visible, and at once when it comes back', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    answer(fixture());
    render(<CampaignAnalytics id={ID} login={LOGIN} />);
    await screen.findByTestId('campaign-analytics');
    expect(vi.mocked(call)).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(vi.mocked(call)).toHaveBeenCalledTimes(2);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(vi.mocked(call)).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(vi.mocked(call)).toHaveBeenCalledTimes(3);
  });

  it('speaks the page’s language (real Hindi), numerals Latin', async () => {
    localStorage.setItem('recharge.lang', 'hi');
    answer(fixture());
    render(
      <LangProvider>
        <CampaignAnalytics id={ID} login={LOGIN} />
      </LangProvider>,
    );
    const section = await screen.findByTestId('campaign-analytics');
    expect(section.getAttribute('lang')).toBe('hi');
    expect(screen.getByText('कैंपेन एनालिटिक्स')).toBeTruthy();
    expect(screen.getByTestId('not-installed-headline').textContent).toBe(
      '2 eSIM क्लेम हुए पर इंस्टॉल नहीं हुए · $2.40',
    );
    localStorage.removeItem('recharge.lang');
  });

  it('Export CSV: every figure, both series, the not-installed rows and the latest claims', () => {
    const lines = analyticsCsv(fixture()).split('\n');
    expect(lines[0]).toBe('section,name,value,at,tier,status,expires_at,tx,arkiv_key,status_as_of');
    expect(lines).toContain('totals,claims,4');
    expect(lines).toContain('money,runOutAt,2026-11-07T18:30:00.000Z');
    expect(lines).toContain('funnel,notInstalled,2');
    expect(lines.filter((l) => l.startsWith('claims_per_day,'))).toHaveLength(14);
    expect(lines.filter((l) => l.startsWith('claims_per_hour,'))).toHaveLength(48);
    expect(lines).toContain(
      `not_installed,age_hours,144,2026-10-31T06:30:00.000Z,orb,ready,2026-11-07T06:30:00.000Z,${tx(1)},${arkiv(1)},2026-11-06T05:30:00.000Z`,
    );
    expect(lines).toContain(`latest_claim,,,2026-11-06T05:30:00.000Z,orb,,,${tx(3)},${arkiv(3)}`);
  });
});
