import { Suspense } from 'react';

import { CampaignByNameRoute } from '../../../components/CampaignByName';

export const metadata = { title: 'Free data from a sponsor' };

/** `/c/<slug>`: claim by ENS name — `<slug>.re-charge.eth`, resolved in the browser (components/CampaignByName.tsx). */
export default function ClaimByName() {
  return (
    <Suspense fallback={null}>
      <CampaignByNameRoute />
    </Suspense>
  );
}
