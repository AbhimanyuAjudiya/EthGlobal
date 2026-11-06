import Link from 'next/link';

export interface SubNavItem {
  href: string;
  label: string;
  current?: boolean;
}

export interface SubNavProps {
  /** The strip's accessible name. */
  label: string;
  items: readonly SubNavItem[];
}

/**
 * A page's own sections as a strip of pill tabs (DESIGN.md §4), under the TopBar inside the AppShell: the same look at
 * every width, scrolling sideways on a phone. `#…` hrefs are in-page anchors.
 */
export function SubNav({ label, items }: SubNavProps) {
  return (
    <nav className="subnav" aria-label={label}>
      {items.map((item) =>
        item.href.startsWith('#') ? (
          <a
            key={item.href}
            href={item.href}
            className="subnav__link"
            aria-current={item.current ? 'page' : undefined}
          >
            {item.label}
          </a>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className="subnav__link"
            aria-current={item.current ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}
