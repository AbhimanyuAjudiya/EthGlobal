import { SponsorShell } from '../../components/SponsorShell';

import type { ReactNode } from 'react';

export const metadata = { title: { default: 'Sponsor', template: '%s · Sponsor · Recharge' } };

/** Sponsor console (DESIGN.md §4): the same AppShell as every screen, its sections in a SubNav. English only. */
export default function SponsorLayout({ children }: { children: ReactNode }) {
  return (
    <div lang="en">
      <SponsorShell>{children}</SponsorShell>
    </div>
  );
}
