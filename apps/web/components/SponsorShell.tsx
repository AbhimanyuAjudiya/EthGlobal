'use client';

import { useParams } from 'next/navigation';

import { SubNav } from './kit/SubNav';
import { AppShell } from './Shell';

import type { ReactNode } from 'react';

/** The four in-page sections of one campaign's dashboard (SponsorTable's headings). */
const CAMPAIGN_SECTIONS = [
  { href: '#claims-title', label: 'Claims' },
  { href: '#expiring-title', label: 'Quotas' },
  { href: '#exports-title', label: 'Exports' },
  { href: '#controls-title', label: 'Settings' },
] as const;

/**
 * The sponsor console's frame (DESIGN.md §4): the one AppShell (More / "Organizers" current, Back to /sponsor on a
 * campaign, the TESTNET rail) with a SubNav of the console's sections. useParams re-renders it on navigation, so the
 * persistent layout's Back follows the page.
 */
export function SponsorShell({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  return (
    <AppShell nav="more" {...(id ? { back: '/sponsor' } : {})} layout="console" money>
      <SubNav
        label="Sponsor console"
        items={[
          { href: '/sponsor', label: 'Campaigns', current: true },
          ...(id ? CAMPAIGN_SECTIONS : []),
        ]}
      />
      {children}
    </AppShell>
  );
}
