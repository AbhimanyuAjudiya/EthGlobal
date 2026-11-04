import { Suspense } from 'react';

import { PlanRoute } from '../../../components/routes';

export const metadata = { title: 'Plan' };

export default function Plan() {
  return (
    <Suspense fallback={<div className="skeleton skeleton--coupon" aria-label="Loading your plan" />}>
      <PlanRoute />
    </Suspense>
  );
}
