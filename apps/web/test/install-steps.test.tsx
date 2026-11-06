// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InstallSteps } from '../components/InstallSteps';
import { Wallets } from '../components/Wallets';
import { plans } from '../lib/store';

import type * as ApiModule from '../lib/api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('../lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      // offline: the screen renders from this device's own records
      me: () => Promise.reject(new mod.ApiError(0, 'network', 'offline in this test')),
    },
  };
});

describe('/install on a computer', () => {
  it('names the plan it installs and offers only the two ways that reach a phone', async () => {
    await plans.adopt('plan-in');
    await plans.adopt('plan-jp');
    await plans.saveMetadata('plan-jp', { destinationCountry: 'JP', eventName: 'ETHTokyo' });
    await plans.saveLpa('plan-jp', 'LPA:1$smdp.example.com$ABC-123-DEF');
    expect(await plans.latest()).toBe('plan-jp');

    render(<InstallSteps />, { wrapper: Wallets });
    expect(await screen.findByText('Two ways to install from this computer')).toBeTruthy();
    expect(screen.getByTestId('install-plan').textContent).toContain('Japan · ETHTokyo');
    // jsdom is a desktop user agent with no coarse pointer: no phone status words, no empty "On this phone"
    expect(screen.getByTestId('status-pill').textContent).toContain('Not installed yet');
    expect(screen.queryByText('On this phone')).toBeNull();
    expect(screen.getByText('Scan a QR code from another screen')).toBeTruthy();
    expect(screen.getByText('Type the details by hand')).toBeTruthy();
    // a second plan on this device: the way to the other trip is one link away
    expect(screen.getByRole('link', { name: 'Not this plan? Open My plans' })).toBeTruthy();
  });
});
