import { Suspense } from 'react';

import { Skeleton } from '../../../components/kit';
import { PlanRoute } from '../../../components/routes';

export const metadata = { title: 'Plan' };

export default function Plan() {
  return (
    <Suspense fallback={<Skeleton shape="balance" label="Loading your plan" />}>
      <PlanRoute />
    </Suspense>
  );
}
