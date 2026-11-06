// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SubNav } from '../components/kit';
import { routeChrome } from '../components/Shell';

describe('sponsor console chrome', () => {
  it('is a More screen: no Back on /sponsor, Back to /sponsor on a campaign', () => {
    expect(routeChrome('/sponsor')).toEqual({ nav: 'more' });
    expect(routeChrome('/sponsor/0xabc')).toEqual({ nav: 'more', back: '/sponsor' });
  });

  it('SubNav marks only the current tab', () => {
    render(
      <SubNav
        label="Sponsor console"
        items={[
          { href: '/sponsor', label: 'Campaigns', current: true },
          { href: '#claims-title', label: 'Claims' },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Sponsor console' });
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Claims' }).getAttribute('href')).toBe('#claims-title');
  });
});
