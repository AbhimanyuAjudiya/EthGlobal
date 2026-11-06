import { ConsoleSectionLinks } from '../../components/ConsoleSectionLinks';
import { ConsoleShell } from '../../components/kit';

import type { ReactNode } from 'react';

export const metadata = { title: { default: 'Sponsor', template: '%s · Sponsor · Recharge' } };

/** Sponsor console (DESIGN.md §4): ConsoleShell, with a campaign's section links once one is open. */
export default function SponsorLayout({ children }: { children: ReactNode }) {
  return (
    <ConsoleShell active="campaigns" aside={<ConsoleSectionLinks />}>
      {children}
    </ConsoleShell>
  );
}
