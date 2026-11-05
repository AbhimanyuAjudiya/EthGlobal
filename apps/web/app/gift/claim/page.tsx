import { Suspense } from 'react';

import { ClaimRoute } from '../../../components/routes';

export const metadata = { title: 'Claim a gift' };

export default function GiftClaim() {
  return (
    <Suspense fallback={null}>
      <ClaimRoute />
    </Suspense>
  );
}
