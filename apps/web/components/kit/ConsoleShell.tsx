import Link from 'next/link';

import { HeaderWallet, SiteMenu, TestnetStrip } from '../Shell';

import type { ReactNode } from 'react';

export interface ConsoleSection {
  id: string;
  label: string;
  href: string;
}

export interface ConsoleShellProps {
  /** The id of the current section. */
  active: string;
  /** Sidebar sections; default: Campaigns. */
  sections?: readonly ConsoleSection[];
  /** Extra sidebar content under the sections (a campaign's section links). */
  aside?: ReactNode;
  children: ReactNode;
}

const DEFAULT_SECTIONS: readonly ConsoleSection[] = [
  { id: 'campaigns', label: 'Campaigns', href: '/sponsor' },
];

/**
 * The sponsor console (DESIGN.md §4): TopBar + a 240 px sidebar from 1024 px (a tab strip on phones) + a 72 rem
 * content column. English only: it carries its own lang.
 */
export function ConsoleShell({
  active,
  sections = DEFAULT_SECTIONS,
  aside,
  children,
}: ConsoleShellProps) {
  return (
    <div className="console-shell" lang="en">
      <header className="app-header topbar">
        <div className="topbar__left">
          <Link href="/" className="wordmark">
            Recharge
          </Link>
        </div>
        <div className="app-header__right">
          <HeaderWallet />
          <SiteMenu />
        </div>
      </header>
      <TestnetStrip />
      <div className="console-shell__body">
        <nav className="console-shell__nav" aria-label="Sponsor console">
          {sections.map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className="console-shell__link"
              aria-current={s.id === active ? 'page' : undefined}
            >
              {s.label}
            </Link>
          ))}
          {aside}
        </nav>
        <main className="console-shell__main">{children}</main>
      </div>
    </div>
  );
}
