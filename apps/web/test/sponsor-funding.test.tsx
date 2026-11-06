// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignForm } from '../components/CampaignForm';
import { associateUsdcCall, htsTokenId, readSponsorFunding } from '../lib/sponsor';

import type * as ApiModule from '../lib/api';
import type * as EnvModule from '../lib/env';
import type * as SponsorModule from '../lib/sponsor';
import type { Wallet } from '../lib/wallet';

const mocks = vi.hoisted(() => {
  const wallet = {
    address: `0x${'12'.repeat(20)}` as const,
    chainId: 296,
    network: 'eip155:296',
    name: 'Sponsor wallet',
    reader: { readContract: vi.fn(), getBlock: vi.fn(), getTransactionReceipt: vi.fn() },
    sendTransaction: vi.fn(),
  };
  return {
    wallet,
    ensure: vi.fn(async () => wallet),
    associated: false,
    confirmAssociation: true,
    balance: 0n,
    allowance: 0n,
    login: vi.fn(),
    register: vi.fn(),
    validate: vi.fn(),
    plans: vi.fn(),
    catalog: vi.fn(),
  };
});
vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('../lib/hooks', () => ({
  useWallet: () => ({ wallet: mocks.wallet }),
  useEnsureChain: () => mocks.ensure,
  useHydrated: () => true,
  useClock: () => 10,
}));
vi.mock('../lib/env', async (original) => ({
  ...(await original<typeof EnvModule>()),
  config: { chainId: 296, dataDropAddress: `0x${'34'.repeat(20)}` },
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: {
    plans: mocks.plans,
    catalog: mocks.catalog,
    validateSponsor: mocks.validate,
    registerSponsor: mocks.register,
  },
}));
vi.mock('../lib/sponsor', async (original) => ({
  ...(await original<typeof SponsorModule>()),
  sponsorLogin: mocks.login,
}));
const TOKEN = '0x0000000000000000000000000000000000068cda';
const TX = `0x${'78'.repeat(32)}`;
/** The one supported destination package the catalog mock offers. */
const PACKAGE = {
  id: 'in-1gb-7d',
  name: 'India 1 GB',
  mb: 1000,
  validityDays: 7,
  wholesaleUsd6: '1200000',
  activation: { startsOn: 'first-network', installWithinDays: 180 },
  cancellation: 'never-installed',
} as const;
const DAY = 86_400_000;
/** A datetime-local value in this device's time zone, as the form reads it back. */
const local = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** Name the campaign, pick IN → the one package, and date a `days`-long event starting in ten days. */
async function planEvent(days = 2) {
  const startsAt = Date.now() + 10 * DAY;
  const dates = {
    startsAt,
    endsAt: startsAt + days * DAY,
    claimUntil: startsAt + DAY,
    reclaimAfter: startsAt + days * DAY,
  };
  fireEvent.change(screen.getByTestId('campaign-name'), { target: { value: 'Mumbai Welcome' } });
  // India is the default destination: its packages load without a click
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Destination' }).value).toBe('IN');
  fireEvent.click(await screen.findByRole('radio', { name: new RegExp(PACKAGE.name) }));
  for (const [key, at] of Object.entries(dates))
    fireEvent.change(screen.getByTestId(`campaign-${key}`), { target: { value: local(at) } });
  return dates;
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.associated = false;
  mocks.confirmAssociation = true;
  mocks.balance = 0n;
  mocks.allowance = 0n;
  mocks.ensure.mockResolvedValue(mocks.wallet);
  mocks.wallet.reader.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'usdc') return TOKEN;
      if (functionName === 'isAssociated') return mocks.associated;
      if (functionName === 'balanceOf') return mocks.balance;
      if (functionName === 'allowance') return mocks.allowance;
      throw new Error('unexpected contract read');
    },
  );
  mocks.wallet.reader.getBlock.mockResolvedValue({
    number: 42n,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  });
  mocks.wallet.reader.getTransactionReceipt.mockResolvedValue({
    status: 'success',
    blockNumber: 42n,
  });
  mocks.wallet.sendTransaction.mockImplementation(async ({ data }: { data: string }) => {
    if (data === '0x0a754de6' && mocks.confirmAssociation) mocks.associated = true;
    return TX;
  });
  mocks.plans.mockResolvedValue({
    sponsor: { minPricePerClaimUsd6: '1200000', maxCampaignDurationMs: 181 * 86400000 },
  });
  mocks.catalog.mockResolvedValue({ country: 'IN', plans: [PACKAGE] });
  mocks.validate.mockResolvedValue(undefined);
  mocks.login.mockResolvedValue({ issuedAt: Date.now(), signature: '0xaa' });
  mocks.register.mockImplementation(async ({ campaign }: { campaign: { id: string } }) => ({
    id: campaign.id,
    auditKey: 'audit',
  }));
});
describe('Hedera campaign funding readiness', () => {
  it('offers the unused-eSIM switch only on a package that cancels never-installed eSIMs', async () => {
    mocks.catalog.mockResolvedValue({
      country: 'IN',
      plans: [
        PACKAGE,
        { ...PACKAGE, id: 'in-1gb-7d-b', name: 'India Basic', cancellation: 'unsupported' },
      ],
    });
    render(<CampaignForm />);
    const toggle = () => screen.getByRole<HTMLInputElement>('switch');
    fireEvent.click(await screen.findByRole('radio', { name: /India Basic/ }));
    expect(toggle().disabled).toBe(true);
    expect(screen.getByText(/Unavailable: this package’s provider does not cancel/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /India 1 GB/ }));
    expect(toggle().disabled).toBe(false);
    expect(
      screen.getByText(/never-installed eSIMs are cancelled and the allocation is returned/),
    ).toBeTruthy();
  });
  it('prefills the claim price at the advertised floor when the provider cost is below it', async () => {
    mocks.catalog.mockResolvedValue({
      country: 'IN',
      plans: [{ ...PACKAGE, name: 'India 1 GB · 7 days', wholesaleUsd6: '1140000' }],
    });
    render(<CampaignForm />);
    // the name already says the size and days, so the chip adds only the cost
    const chip = await screen.findByRole('radio', { name: /India 1 GB · 7 days/ });
    expect(chip.closest('label')?.textContent).toBe('India 1 GB · 7 days$1.14 per eSIM');
    fireEvent.click(chip);
    expect(screen.getByTestId<HTMLInputElement>('campaign-priceUsd').value).toBe('1.20');
    expect(screen.getByText('Floor $1.20 · provider cost $1.14')).toBeTruthy();
    expect(screen.getByTestId<HTMLInputElement>('campaign-budgetUsd').value).toBe('12.00');
    expect(screen.getByTestId('campaign-total').textContent).toBe(
      '10 claims × $1.20 = $12.00 USDC',
    );
    fireEvent.change(screen.getByTestId('campaign-budgetUsd'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('campaign-maxClaims'), { target: { value: '5' } });
    expect(screen.getByTestId<HTMLInputElement>('campaign-budgetUsd').value).toBe('20');
    // the hourly limit may not exceed the cap: the field says so and the create button waits
    fireEvent.change(screen.getByTestId('campaign-perHour'), { target: { value: '1000' } });
    expect(screen.getByTestId('campaign-perHour').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/At most the claims cap \(5\)/)).toBeTruthy();
    expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByTestId('campaign-perHour'), { target: { value: '5' } });
    expect(screen.getByTestId('campaign-perHour').getAttribute('aria-invalid')).toBeNull();
  });
  it('queries the actual pool token using the sponsor as the HRC719 caller', async () => {
    expect(await readSponsorFunding(mocks.wallet as unknown as Wallet)).toEqual({
      token: TOKEN,
      associated: false,
      balance: 0n,
    });
    expect(mocks.wallet.reader.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        functionName: 'isAssociated',
        account: mocks.wallet.address,
      }),
    );
    expect(associateUsdcCall(TOKEN)).toEqual({ to: TOKEN, data: '0x0a754de6' });
    expect(htsTokenId(TOKEN)).toBe('0.0.429274');
    expect(htsTokenId(mocks.wallet.address)).toBeUndefined();
  });
  it('associates explicitly, reads back, then requires funded USDC before approve/create', async () => {
    render(<CampaignForm />);
    await planEvent();
    fireEvent.click(await screen.findByRole('button', { name: 'Associate USDC' }));
    await screen.findByText('USDC associated · balance $0.00 USDC');
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledWith({ to: TOKEN, data: '0x0a754de6' });
    expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Add \$12.00 USDC to this wallet on Hedera testnet/)).toBeTruthy();
    mocks.balance = 12_000_000n;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh USDC balance' }));
    await waitFor(() =>
      expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByTestId('audit-key');
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(3);
    expect(mocks.register).toHaveBeenCalledOnce();
  });
  it('an allowance already on chain skips the approval: one transaction, the create', async () => {
    mocks.associated = true;
    mocks.balance = 12_000_000n;
    mocks.allowance = 12_000_000n;
    render(<CampaignForm />);
    await planEvent();
    await waitFor(() =>
      expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByTestId('audit-key');
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(1);
    const [[only]] = mocks.wallet.sendTransaction.mock.calls as [[{ data: string }]];
    expect(only.data.startsWith('0x095ea7b3')).toBe(false); // not approve(address,uint256)
    expect(mocks.register).toHaveBeenCalledOnce();
  });
  it('a successful transaction without confirmed association stays blocked and rechecks the same hash', async () => {
    mocks.confirmAssociation = false;
    render(<CampaignForm />);
    await planEvent();
    fireEvent.click(await screen.findByRole('button', { name: 'Associate USDC' }));
    await screen.findByRole('alert');
    expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Associate USDC' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Associate USDC' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('does not allow funding when the wallet RPC cannot verify association', async () => {
    mocks.wallet.reader.readContract.mockRejectedValueOnce(new Error('RPC unavailable'));
    render(<CampaignForm />);
    await planEvent();
    await screen.findByRole('alert');
    expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(true);
    expect(mocks.wallet.sendTransaction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh USDC balance' }));
    await screen.findByRole('button', { name: 'Associate USDC' });
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('a rejected association leaves the campaign unfunded and allows an explicit retry', async () => {
    mocks.wallet.sendTransaction.mockRejectedValueOnce({ code: 4001 });
    render(<CampaignForm />);
    await planEvent();
    fireEvent.click(await screen.findByRole('button', { name: 'Associate USDC' }));
    await screen.findByRole('alert');
    expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Associate USDC' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('rechecks the balance at funding time and sends nothing if it dropped', async () => {
    mocks.associated = true;
    mocks.balance = 12_000_000n;
    render(<CampaignForm />);
    await planEvent();
    await waitFor(() =>
      expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(false),
    );
    mocks.balance = 1_000_000n;
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByText(/This wallet has \$1.00 USDC. Add \$11.00 USDC/, { selector: 'p' });
    expect(mocks.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('resumes an already funded campaign even when its transfer depleted the wallet', async () => {
    mocks.associated = true;
    mocks.balance = 12_000_000n;
    mocks.login.mockRejectedValueOnce(new Error('Wallet closed'));
    const first = render(<CampaignForm />);
    await planEvent();
    await waitFor(() =>
      expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByText('Wallet closed');
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(2);
    first.unmount();
    mocks.balance = 0n;
    render(<CampaignForm />);
    const resume = await screen.findByRole('button', { name: 'Resume this campaign' });
    await waitFor(() => expect(resume.hasAttribute('disabled')).toBe(false));
    fireEvent.click(resume);
    await screen.findByTestId('audit-key');
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(2);
  });
});
