// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EntitledResponse, PlansResponse } from '@ethglobal/protocol/schemas';

import { SLOW_CLAIM_MS, VerifySheet } from '../components/VerifySheet';
import { Wallets } from '../components/Wallets';
import { LangProvider, LangSwitch } from '../i18n/lang';
import { ApiError } from '../lib/api';
import { del } from '../lib/store';

import type * as ApiModule from '../lib/api';
import type * as DeliverModule from '../lib/deliver';

const mocks = vi.hoisted(() => {
  const plans: PlansResponse = {
    mode: 'local',
    campaign: {
      id: `0x${'3'.repeat(64)}`,
      name: 'Mumbai Welcome',
      sponsor: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      bundleMb: { orb: 300, document: 150, device: 0 },
      remainingClaims: 10,
      maxClaims: 20,
      paused: false,
      expiresAt: 2_000_000_000_000,
      network: 'eip155:31337',
    },
    paid: { stepMb: 100, priceUsd6PerStep: '400000', validityDays: 7, accepts: [] },
    gift: { sizesMb: [100], claimWindowS: 3600 },
    simulated: { usage: true, personhood: true },
  };
  return {
    plans,
    push: vi.fn(),
    challenge: vi.fn(),
    rpContext: vi.fn(),
    claim: vi.fn<(body: { sessionPubKey: string }, recoveryToken?: string) => Promise<unknown>>(),
    previewTicket: vi.fn(),
    deliver: vi.fn(),
    poll: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../lib/hooks', () => ({
  usePlans: () => ({ plans: mocks.plans, error: undefined, loading: false }),
  useClock: () => Date.now(),
}));
vi.mock('../lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      challenge: mocks.challenge,
      rpContext: mocks.rpContext,
      claim: mocks.claim,
      previewTicket: mocks.previewTicket,
    },
  };
});
vi.mock('../lib/local/world-sim', () => ({ simulatedProof: () => Promise.resolve({ sim: true }) }));
const CONNECTOR = 'https://world.org/verify?t=wld&i=test-request';
vi.mock('@worldcoin/idkit-core', () => ({
  documentLegacy: () => ({}),
  IDKit: {
    request: () => ({
      preset: () => Promise.resolve({ connectorURI: CONNECTOR, pollUntilCompletion: mocks.poll }),
    }),
  },
}));
vi.mock('../lib/deliver', async (importOriginal) => ({
  ...(await importOriginal<typeof DeliverModule>()),
  deliver: mocks.deliver,
}));

const CHALLENGE = {
  nonce: `0x${'1'.repeat(64)}`,
  audience: 'recharge',
  path: '/claim',
  exp: 2_000_000_000_000,
  signal: `0x${'2'.repeat(64)}`,
} as const;
/** The 202 body: a claimed, pending profile — no sealedLpa (T-25). */
const PENDING: EntitledResponse = {
  entitlementKey: `ent-${'a'.repeat(40)}`,
  kind: 'free',
  status: 'pending-profile',
  tier: 'orb',
  mbTotal: 300,
  expiresAt: 2_000_000_000_000,
  validityDays: 7,
  claimTx: `0x${'5'.repeat(64)}`,
  receipt: { arkivKey: `0x${'ab'.repeat(32)}` },
};

/** Mounts the sheet in MODE=local (the simulator path needs no IDKit) and waits for the claim button. */
async function mount() {
  vi.stubEnv('NEXT_PUBLIC_MODE', 'local');
  mocks.challenge.mockResolvedValue(CHALLENGE);
  mocks.rpContext.mockResolvedValue({});
  const view = render(<VerifySheet />, { wrapper: Wallets });
  const button = await screen.findByRole('button', { name: 'Simulated World ID' });
  return { ...view, button };
}

const click = (button: HTMLElement) =>
  act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });

it('is one kit screen: Stepper at Prove, the title, "What you get" from /plans and the per-human notice', async () => {
  const { button } = await mount();
  expect(
    screen.getByRole('list', { name: 'Steps' }).querySelector('[aria-current="step"]')?.textContent,
  ).toBe('1Prove');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Prove you're one human");
  const tiers = screen.getByTestId('tier-ledger');
  expect(tiers.textContent).toContain('What you get');
  expect(tiers.textContent).toMatch(/Orb.*300\sMB free.*Document.*150\sMB free/);
  expect(screen.getByText('One free bundle per human, not per phone.')).toBeTruthy();
  expect(button.closest('.action-bar')).toBeTruthy();
  vi.unstubAllEnvs();
});

describe('VerifySheet — a slow or lost claim answer (RT-W-13)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('a 202 (profile pending) is delivered like a 201 and routes to the plan page', async () => {
    const { button } = await mount();
    mocks.claim.mockResolvedValue({ status: 202, headers: new Headers(), data: PENDING });
    mocks.deliver.mockResolvedValue(PENDING.entitlementKey);
    await click(button);
    await vi.waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(`/plan/${PENDING.entitlementKey}`),
    );
    expect(mocks.deliver).toHaveBeenCalledWith(
      PENDING,
      CHALLENGE.nonce,
      expect.objectContaining({ you: '$0.00', sponsor: 'Mumbai Welcome' }),
      expect.stringMatching(/^0x[0-9a-f]{64}$/),
    );
  });

  it('a claim request that dies (timeout, network) says the claim may have gone through and offers "Check my plans", not "Try again"', async () => {
    const { button } = await mount();
    mocks.claim.mockRejectedValue(new ApiError(0, 'network', 'HTTP timeout'));
    await click(button);
    const status = await screen.findByTestId('claim-unconfirmed');
    expect(status.textContent).toContain('may still have gone through');
    expect(status.textContent).not.toContain('Check your connection');
    expect(screen.getByRole('link', { name: 'Check my plans' }).getAttribute('href')).toBe('/plan');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('explicit recovery proves again with the original private session and recovery token', async () => {
    const { button } = await mount();
    mocks.claim
      .mockRejectedValueOnce(new ApiError(0, 'network', 'lost response'))
      .mockResolvedValueOnce({ status: 202, data: PENDING });
    mocks.deliver.mockResolvedValue(PENDING.entitlementKey);
    await click(button);
    await click(await screen.findByRole('button', { name: 'Verify again to recover' }));
    await vi.waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(`/plan/${PENDING.entitlementKey}`),
    );
    expect(mocks.claim.mock.calls[1]![0].sessionPubKey).toBe(
      mocks.claim.mock.calls[0]![0].sessionPubKey,
    );
    expect(mocks.claim.mock.calls[1]![1]).toBe(mocks.claim.mock.calls[0]![1]);
    expect(mocks.challenge).toHaveBeenCalledTimes(2);
  });

  it('past 10 s the Checking line says what is running and that it takes a while', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { button, rerender } = await mount();
    mocks.claim.mockReturnValue(new Promise(() => undefined));
    await click(button);
    expect(await screen.findByText(/^Checking · \d+ s$/)).toBeTruthy();
    vi.setSystemTime(Date.now() + SLOW_CLAIM_MS);
    rerender(<VerifySheet />);
    expect(screen.getByRole('status').textContent).toMatch(
      /^Claiming on-chain and preparing your eSIM · \d+ s · this can take a minute$/,
    );
  });
});

describe('VerifySheet — World App on the same phone is one tap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /** Live mode up to `waiting` with a connector URI; the poll never settles (World App still open). */
  async function wait(coarse: boolean) {
    vi.stubEnv('NEXT_PUBLIC_MODE', 'live');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }));
    mocks.challenge.mockResolvedValue(CHALLENGE);
    mocks.rpContext.mockResolvedValue({});
    mocks.poll.mockReturnValue(new Promise(() => undefined));
    render(<VerifySheet />, { wrapper: Wallets });
    await click(await screen.findByRole('button', { name: 'Open World App' }));
    await screen.findByText(/^Waiting for World App/);
  }

  it('on a phone: an "Open World App" link to the connector URI, no QR until "Show QR instead"', async () => {
    await wait(true);
    const open = await screen.findByRole('link', { name: 'Open World App' });
    expect(open.getAttribute('href')).toBe(CONNECTOR);
    expect(screen.queryByRole('img', { name: 'Scan with World App' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show QR instead' }));
    expect(screen.getByRole('img', { name: 'Scan with World App' })).toBeTruthy();
    expect(mocks.poll).toHaveBeenCalledTimes(1);
  });

  it('on a desktop: the QR first, with a small "Open World App" link', async () => {
    await wait(false);
    expect(await screen.findByRole('img', { name: 'Scan with World App' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open World App' }).getAttribute('href')).toBe(
      CONNECTOR,
    );
    expect(screen.queryByRole('button', { name: 'Show QR instead' })).toBeNull();
  });
});

describe('verification retry and cancellation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it.each([false, true])(
    'ignores World completion after Cancel on desktop/mobile (%s)',
    async (coarse) => {
      vi.stubEnv('NEXT_PUBLIC_MODE', 'live');
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: coarse && q === '(pointer: coarse)',
      }));
      mocks.challenge.mockResolvedValue(CHALLENGE);
      mocks.rpContext.mockResolvedValue({});
      let finish!: (value: { success: true; result: unknown }) => void;
      mocks.poll.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      render(<VerifySheet />, { wrapper: Wallets });
      await click(await screen.findByRole('button', { name: 'Open World App' }));
      await screen.findByText(/^Waiting for World App/);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await act(async () => {
        finish({ success: true, result: { proof: 'late' } });
      });
      expect(mocks.claim).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
    },
  );
  it('prepares a fresh challenge after a consumed invalid proof', async () => {
    const { button } = await mount();
    mocks.claim
      .mockRejectedValueOnce(new ApiError(400, 'invalid_proof', 'invalid'))
      .mockResolvedValueOnce({ status: 202, data: PENDING });
    mocks.deliver.mockResolvedValue(PENDING.entitlementKey);
    await click(button);
    await click(await screen.findByRole('button', { name: 'Simulated World ID' }));
    await vi.waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(2));
    expect(mocks.challenge).toHaveBeenCalledTimes(2);
    expect(mocks.claim.mock.calls[0]![0].sessionPubKey).toBe(
      mocks.claim.mock.calls[1]![0].sessionPubKey,
    );
  });
});

it('keeps the claim session stable when language changes during delivery', async () => {
  vi.stubEnv('NEXT_PUBLIC_MODE', 'local');
  localStorage.removeItem('recharge.lang');
  mocks.challenge.mockResolvedValue(CHALLENGE);
  mocks.rpContext.mockResolvedValue({});
  let finish!: (value: unknown) => void;
  mocks.claim.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mocks.deliver.mockResolvedValue(PENDING.entitlementKey);
  render(
    <LangProvider>
      <Wallets>
        <VerifySheet />
      </Wallets>
      {/* the shell no longer renders a switch; the language can still change (?lang=, another tab) */}
      <LangSwitch />
    </LangProvider>,
  );
  await click(await screen.findByRole('button', { name: 'Simulated World ID' }));
  await vi.waitFor(() => expect(mocks.claim).toHaveBeenCalled());
  const original = mocks.claim.mock.calls.at(-1)![0].sessionPubKey;
  fireEvent.click(screen.getByRole('button', { name: 'हिं' }));
  await act(async () => {
    finish({ status: 202, data: PENDING });
  });
  expect(mocks.challenge).toHaveBeenCalledTimes(1);
  expect(mocks.deliver.mock.calls.at(-1)![3]).toBe(original);
  localStorage.removeItem('recharge.lang');
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('VerifySheet — a pass link says which event it claims for (live)', () => {
  const LOCAL = mocks.plans;
  const ID = `0x${'4'.repeat(64)}`;
  const PASS = `0x${'7'.repeat(64)}`;
  /** What the pass preview discloses: live GET /plans itself carries `campaign: null`. */
  const EVENT: PlansResponse = {
    ...LOCAL,
    mode: 'live',
    campaign: {
      ...LOCAL.campaign!,
      id: ID,
      name: 'Goa Welcome',
      event: {
        destinationCountry: 'IN',
        startsAt: Date.UTC(2026, 11, 5),
        endsAt: Date.UTC(2026, 11, 7),
        reclaimAfter: Date.UTC(2026, 11, 8),
        ticketRequired: true,
        reclaimUnused: false,
        refundBasis: 'claim-price',
        noticeVersion: 1,
      },
    },
  };
  afterEach(async () => {
    mocks.plans = LOCAL;
    window.location.hash = '';
    await del(`ticket:redemption:claim:${ID}`);
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('names the event, its country and the bundle from the preview, before World App is asked', async () => {
    vi.stubEnv('NEXT_PUBLIC_MODE', 'live');
    mocks.plans = { ...EVENT, campaign: null };
    mocks.challenge.mockResolvedValue(CHALLENGE);
    mocks.previewTicket.mockResolvedValue({ valid: true, campaignId: ID, plans: EVENT });
    window.location.hash = `#ticket=${PASS}`;
    render(<VerifySheet campaignId={ID} />, { wrapper: Wallets });
    const event = await screen.findByTestId('claim-event');
    expect(event.textContent).toContain('Goa Welcome');
    expect(event.textContent).toContain('India');
    expect(event.textContent).toMatch(/300\sMB/);
    expect(mocks.previewTicket).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: ID, ticketPass: PASS }),
      expect.any(String),
    );
    // the pass left the address bar, the claim is open, and nothing says a pass is missing
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('button', { name: 'Open World App' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(screen.queryByTestId('pass-needed')).toBeNull();
  });
});
