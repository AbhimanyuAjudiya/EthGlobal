import { Suspense } from 'react';

import { ClaimGift } from '../../../components/ClaimGift';
import { AppShell } from '../../../components/kit';

export const metadata = { title: 'Claim a gift' };

/** `/gift/claim?id=&name=` — the gift tab's sub-screen; ClaimGift reads and checks the params itself. */
export default function GiftClaim() {
  return (
    <AppShell nav="gift" back="/gift">
      <Suspense fallback={null}>
        <ClaimGift />
      </Suspense>
    </AppShell>
  );
}
