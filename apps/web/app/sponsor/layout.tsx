import Link from 'next/link';

import { ConsoleSectionLinks } from '../../components/ConsoleSectionLinks';
import { HeaderWallet, SiteMenu, TestnetStrip } from '../../components/Shell';

import type { ReactNode } from 'react';

export const metadata = { title: { default: 'Sponsor', template: '%s · Sponsor · Recharge' } };

/** Sponsor console shell: the TESTNET rail, a labelled rail (a row on phones, a sticky column from 1024 px) and the 72 rem console column; density per design-foundations §5a. */
export default function SponsorLayout({ children }: { children: ReactNode }) {
  return (
    // the console is English-only: it carries its own lang so a traveller's हिं choice does not mislabel it
    <div className="console" lang="en">
      <TestnetStrip />
      <div className="console__body">
        <nav className="console__rail" aria-label="Sponsor console">
          <Link href="/" className="wordmark console__home">
            Recharge
          </Link>
          {/* the traveller's flows, as on every other screen */}
          <SiteMenu />
          <Link href="/sponsor">Campaigns</Link>
          <ConsoleSectionLinks />
        </nav>
        <main className="console__main">
          {/* the sponsor wallet: the same one control as every traveller screen, top-right */}
          <div className="console__wallet">
            <HeaderWallet />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
