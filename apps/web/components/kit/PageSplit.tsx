import type { ReactNode } from 'react';

export interface PageSplitProps {
  /** The hero blocks (BalanceCard / Ticket, QuickActions, a status Card) and the screen's ActionBar, last. */
  hero: ReactNode;
  /** The rest of the screen: Sections, ListGroups, Notices. */
  children?: ReactNode;
  /** Optional blocks under the children. */
  aside?: ReactNode;
}

/**
 * The laptop split (DESIGN.md §4). On a phone, and in a `single` / `wide` AppShell, it adds no box: hero, children and
 * aside stack in the page exactly as before, the ActionBar still last and sticky. In a `split` AppShell from 1024 px
 * it is a 12-column grid: the hero sticky in columns 1–5 with the ActionBar at its foot, the rest in 6–12.
 */
export function PageSplit({ hero, children, aside }: PageSplitProps) {
  return (
    <div className="page-split">
      <div className="page-split__hero">{hero}</div>
      <div className="page-split__main">
        {children}
        {aside ? <div className="page-split__aside">{aside}</div> : null}
      </div>
    </div>
  );
}
