// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeResponse } from '@ethglobal/protocol/schemas';

import { PlanActions } from '../components/PlanActions';
import { Wallets } from '../components/Wallets';
import { plans } from '../lib/store';

const KEY = 'paid:0x70997970c51812dc3a010c7d01b50e0d17dc79c8:0xabc123';
const LPA = 'LPA:1$rsp.example.com$MATCH1ID';
const me = (over: Partial<MeResponse> = {}): MeResponse => ({
  entitlementKey: KEY,
  kind: 'paid',
  status: 'ready',
  tier: 'none',
  mbTotal: 100,
  mbUsed: 0,
  remainingMb: 100,
  usageAsOf: Date.now(),
  usageSource: 'none',
  expiresAt: Date.now() + 86_400_000,
  arkivKey: 'ent_000001',
  ledgerReadAt: Date.now(),
  cached: false,
  degraded: false,
  ...over,
});
const view = (m: MeResponse) =>
  render(
    <Wallets>
      <PlanActions entitlementKey={KEY} me={m} />
    </Wallets>,
  );

describe('PlanActions', () => {
  it('Send to someone: the share sheet gets the code and the plan link in its text, never in a URL', async () => {
    await plans.saveLpa(KEY, LPA);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    view(me());
    fireEvent.click(await screen.findByRole('button', { name: 'Send to someone' }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const [data] = share.mock.calls[0] as [ShareData];
    expect(Object.keys(data).sort()).toEqual(['text', 'title']);
    expect(data.text).toContain(LPA);
    expect(data.text).toContain(`/plan/${encodeURIComponent(KEY)}`);
    expect(screen.getByText(/Anyone with this code can install the eSIM once/)).toBeTruthy();
    await plans.forgetLpa(KEY);
  });

  it('without the code in this browser: says where to send it from', async () => {
    view(me());
    expect(await screen.findByText(/Send it from the device that bought it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send to someone' })).toBeNull();
  });

  it('cancel: only when /me offers a refund; confirms inline (never window.confirm), then asks for the paying wallet', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { unmount } = view(me());
    expect(screen.queryByRole('button', { name: /Cancel plan/ })).toBeNull();
    unmount();
    view(
      me({
        refundable: {
          usd6: '390000',
          network: 'eip155:84532',
          to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel plan & refund $0.39' }));
    expect(screen.getByRole('group').textContent).toContain('$0.39 goes back to 0x7099…79C8');
    expect(screen.getByRole('button', { name: 'Connect the wallet that paid' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my plan' }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('cancelled: the final state from /me, refunded with its transaction or pending with the support line', () => {
    const tx = `0x${'7c'.repeat(32)}`;
    const { unmount } = view(
      me({ cancelledAt: 1, expiresAt: 1, refund: { network: 'eip155:84532', usd6: '390000', tx } }),
    );
    expect(screen.getByText('Plan cancelled · $0.39 refunded')).toBeTruthy();
    unmount();
    view(me({ cancelledAt: 1, expiresAt: 1, refund: { network: 'eip155:84532', usd6: '390000' } }));
    expect(screen.getByText('Plan cancelled · refund of $0.39 pending')).toBeTruthy();
    expect(screen.getByText(/contact support/)).toBeTruthy();
  });
  it('an unknown refund outcome asks for review without claiming it was refunded', () => {
    view(
      me({
        cancelledAt: 1,
        expiresAt: 1,
        refund: { network: 'eip155:84532', usd6: '390000', recovery: 'manual' },
      }),
    );
    expect(
      screen.getByText(
        'Refund needs review. Your eSIM is cancelled; contact support with the receipt.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/refunded$/)).toBeNull();
  });
});
