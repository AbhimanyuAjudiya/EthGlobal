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
      <a href="#claims-title">Claims</a>
      <a href="#expiring-title">Quotas</a>
      <a href="#exports-title">Exports</a>
      <a href="#controls-title">Settings</a>
    </>
  );
}
