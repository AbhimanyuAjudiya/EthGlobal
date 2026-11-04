import Link from 'next/link';

import { TestnetStrip } from '../../components/Shell';

import type { ReactNode } from 'react';

export const metadata = { title: { default: 'Sponsor', template: '%s · Sponsor · Recharge' } };

/** Sponsor console shell: a labelled rail and the TESTNET rail; density per design-foundations §5a. */
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
          <Link href="/sponsor">Campaigns</Link>
          <a href="#claims-title">Claims</a>
          <a href="#expiring-title">Quotas</a>
          <a href="#controls-title">Settings</a>
        </nav>
        <main className="console__main">{children}</main>
      </div>
    </div>
  );
}
