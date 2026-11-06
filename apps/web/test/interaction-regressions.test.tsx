// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentPolicyPut, AgentPolicyView } from '@ethglobal/protocol/schemas';

import { AgentSheet } from '../components/AgentSheet';
import { GiftForm } from '../components/GiftForm';
import { ApiError } from '../lib/api';

import type * as ApiModule from '../lib/api';
import type * as HooksModule from '../lib/hooks';
import type * as StoreModule from '../lib/store';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => {
  const wallet = {
    address: `0x${'ab'.repeat(20)}`,
    network: 'eip155:31337',
    signTypedData: vi.fn(),
  };
  return {
    wallet,
    me: vi.fn(async (): Promise<{ mbTotal: number; kind?: string; network?: string }> => ({
      mbTotal: 1000,
    })),
    ensure: vi.fn(async () => wallet),
    quote: vi.fn(),
    savePolicy: vi.fn<(body: AgentPolicyPut) => Promise<AgentPolicyView>>(),
    loadPolicy: vi.fn(async () => ({
      owner: wallet.address,
      spentTodayUsd6: '0',
      policy: { paused: false, maxUsd6PerDay: '8000000', thresholdMb: 200, stepMb: 1000 },
    })),
  };
});
vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('../components/Shell', () => ({
  AppHeader: () => null,
  TabBar: () => null,
  TopBar: () => null,
  BottomNav: () => null,
  Screen: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  // the v3 shell: children and the ActionBar's primary render; chrome does not
  AppShell: ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
    <div>
      {children}
      {action}
    </div>
  ),
  routeChrome: () => ({}),
  useWalletLabel: () => () => 'Test wallet',
  useProofShown: () => false,
}));
vi.mock('../lib/hooks', async (original) => ({
  ...(await original<typeof HooksModule>()),
  useWallet: () => ({ wallet: mocks.wallet }),
  useEnsureChain: () => mocks.ensure,
  usePlans: () => ({ plans: undefined }),
  useClock: () => 1000,
}));
vi.mock('../lib/store', async (original) => ({
  ...(await original<typeof StoreModule>()),
  plans: { latest: async () => 'plan-one', holder: async () => undefined },
}));
vi.mock('../lib/arkiv-read', () => ({
  planHash: async () => 'hash',
  readTopUps: async () => [],
  topUpsRequest: () => ({}),
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: {
    me: mocks.me,
    receipts: async () => [],
    agentPolicy: mocks.loadPolicy,
    putAgentPolicy: mocks.savePolicy,
    giftQuote: mocks.quote,
  },
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe('interaction state stays aligned with confirmed data', () => {
  it('an unsaved agent policy stays a draft until explicitly enabled', async () => {
    mocks.loadPolicy.mockRejectedValueOnce(new ApiError(404, 'not_found', 'No policy'));
    mocks.wallet.signTypedData.mockResolvedValue(`0x${'ab'.repeat(65)}`);
    mocks.savePolicy.mockImplementation(async (body) => ({
      ...body,
      spentTodayUsd6: '0',
      updatedAt: body.issuedAt,
    }));
    render(<AgentSheet />);
    const enable = await screen.findByRole('button', { name: 'Save and enable policy' });
    expect(screen.queryByRole('switch', { name: 'Pause' })).toBeNull();
    expect(screen.getByTestId('agent-sentence').textContent).toMatch(/^Set up/);
    expect(
      screen.getByText(/An operator must enroll this plan and fund the agent's wallet/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '$20' }));
    expect(mocks.savePolicy).not.toHaveBeenCalled();
    fireEvent.click(enable);
    await screen.findByRole('switch', { name: 'Pause' });
    expect(mocks.savePolicy.mock.calls[0]?.[0].policy).toMatchObject({
      paused: false,
      maxUsd6PerDay: '20000000',
    });
  });
  it('native Hedera purchases offer manual data without an unsupported EVM policy', async () => {
    mocks.me.mockResolvedValueOnce({ mbTotal: 1000, kind: 'paid', network: 'hedera:testnet' });
    render(<AgentSheet />);
    const link = await screen.findByRole('link', { name: 'Add data manually' });
    expect(link.getAttribute('href')).toBe('/pay?key=plan-one');
    expect(screen.getByRole('status').textContent).toContain('native Hedera account');
    expect(screen.queryByRole('button', { name: 'Save and enable policy' })).toBeNull();
    expect(mocks.loadPolicy).not.toHaveBeenCalled();
    expect(mocks.savePolicy).not.toHaveBeenCalled();
  });
  it('a failed policy read does not present defaults as an editable new policy', async () => {
    mocks.loadPolicy.mockRejectedValueOnce(new ApiError(0, 'network', 'offline'));
    render(<AgentSheet />);
    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByRole('button', { name: 'Save and enable policy' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Pause' })).toBeNull();
    expect(mocks.savePolicy).not.toHaveBeenCalled();
  });
  it('a rejected Pause leaves the agent visibly running', async () => {
    mocks.wallet.signTypedData.mockRejectedValue({
      code: 4001,
      message: 'User rejected the request',
    });
    render(<AgentSheet />);
    const pause = await screen.findByRole<HTMLInputElement>('switch', { name: 'Pause' });
    const sentence = screen.getByTestId('agent-sentence').textContent;
    fireEvent.click(pause);
    await waitFor(() => expect(pause.hasAttribute('disabled')).toBe(false));
    expect(pause.checked).toBe(false);
    expect(screen.getByTestId('agent-sentence').textContent).toBe(sentence);
    expect(mocks.savePolicy).not.toHaveBeenCalled();
  });
  it('a slow old ENS lookup cannot replace the current resolved recipient', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const resolves = new Map<string, (v: unknown) => void>();
    mocks.quote.mockImplementation(
      (name: string) =>
        new Promise((resolve) => {
          resolves.set(name, resolve);
        }),
    );
    render(<GiftForm />);
    fireEvent.change(screen.getByTestId('gift-name'), { target: { value: 'alice.eth' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    fireEvent.change(screen.getByTestId('gift-name'), { target: { value: 'bob.eth' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    await act(async () => {
      resolves.get('bob.eth')!({ status: 402 });
    });
    await act(async () => {
      resolves.get('alice.eth')!({ status: 402 });
    });
    expect(screen.getByTestId('gift-resolution').getAttribute('data-state')).toBe('resolves');
    expect(screen.getByTestId('gift-resolution').textContent).toContain('bob.eth resolves');
  });
});
