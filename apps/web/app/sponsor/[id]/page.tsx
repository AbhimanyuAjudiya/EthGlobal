import { Suspense } from 'react';

import { SponsorRoute } from '../../../components/routes';

export const metadata = { title: 'Campaign' };

export default function SponsorCampaign() {
  return (
    <Suspense fallback={null}>
      <SponsorRoute />
    </Suspense>
  );
}
