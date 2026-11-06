// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MyPlans } from '../components/MyPlans';
import { Wallets } from '../components/Wallets';
import { plans } from '../lib/store';

import type * as ApiModule from '../lib/api';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      // offline: the list renders from this device's own records, nothing else
      me: () => Promise.reject(new mod.ApiError(0, 'network', 'offline in this test')),
      plans: () => Promise.reject(new mod.ApiError(503, 'internal_error', 'not in this test')),
    },
  };
});

describe('/plan · My plans', () => {
  it('lists every saved plan by destination and "Make current" re-points plans.latest()', async () => {
    await plans.adopt('plan-in');
    await plans.saveMetadata('plan-in', { destinationCountry: 'IN', eventName: 'ETHIndia' });
    await plans.adopt('plan-jp');
    await plans.saveMetadata('plan-jp', { destinationCountry: 'JP', eventName: 'ETHTokyo' });
    expect(await plans.latest()).toBe('plan-jp');

    render(<MyPlans />, { wrapper: Wallets });
    expect(await screen.findByText('India')).toBeTruthy();
    expect(screen.getByText('Japan')).toBeTruthy();
    expect(screen.getByText('ETHIndia')).toBeTruthy();
    expect(screen.getByText('ETHTokyo')).toBeTruthy();

    // only the plan that is not current offers the switch
    const select = screen.getAllByRole('button', { name: 'Make current' });
    expect(select).toHaveLength(1);
    fireEvent.click(select[0]!);
    await waitFor(async () => expect(await plans.latest()).toBe('plan-in'));
    expect(mocks.push).toHaveBeenCalledWith('/plan/plan-in');
  });
});
