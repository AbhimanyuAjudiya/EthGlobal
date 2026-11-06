'use client';

import { useParams } from 'next/navigation';

/**
 * The console rail's section links: in-page anchors into one campaign's dashboard (/sponsor/<id>). On /sponsor
 * itself there is no campaign and nothing to jump to, so the rail shows only "Campaigns" there.
 */
export function ConsoleSectionLinks() {
  const { id } = useParams<{ id?: string }>();
  if (!id) return null;
  return (
    <>
      <a className="console-shell__link" href="#claims-title">
        Claims
      </a>
      <a className="console-shell__link" href="#expiring-title">
        Quotas
      </a>
      <a className="console-shell__link" href="#exports-title">
        Exports
      </a>
      <a className="console-shell__link" href="#controls-title">
        Settings
      </a>
    </>
  );
}
